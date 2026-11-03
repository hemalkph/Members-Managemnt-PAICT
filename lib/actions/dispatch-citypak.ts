"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult } from "@/lib/action-result";
import { NOT_ALLOWED } from "@/lib/auth";
import { toDbRows } from "@/lib/citypak/bulk-uploads";
import { CitypakError } from "@/lib/citypak/http";
import { orderDbRows } from "@/lib/citypak/orders";
import { chooseProvider, type CitypakProvider } from "@/lib/citypak/provider";
import { collectBulkUploads, collectOrders, type Collected, type Progress } from "@/lib/citypak/sync";
import { dispatchActionContext } from "@/lib/dispatch/access";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

export type SyncSummary = {
  outcome: "ok" | "partial";
  fetched: number;
  new: number;
  updated: number;
  unchanged: number;
  rejected: number;
  truncated: boolean;
};

/** What a failed sync means for the person who pressed the button. */
const SYNC_ERROR: Record<string, string> = {
  unauthorised: "Citypak refused the credentials. Ask a main admin to check the Citypak settings.",
  rate_limited: "Citypak asked us to slow down. Try again in a few minutes.",
  network: "Couldn't reach Citypak. Check the connection and try again.",
  server: "Citypak had a problem. Try again later.",
  invalid_response: "Citypak sent something we couldn't read. Nothing was changed.",
  save_failed: "The batches couldn't be saved. Nothing was changed.",
  internal: "Something went wrong. Nothing was changed.",
};
const SAVE_FAILED_ORDERS = "The orders couldn't be saved. Nothing was changed.";
const NOT_RECORDED = "The sync failed and the failure couldn't be recorded. Tell an admin.";

type Stream<T> = {
  name: "bulk_uploads" | "orders";
  collect: (provider: CitypakProvider, progress: Progress) => Promise<Collected<T>>;
  save: "citypak_sync_bulk_uploads" | "citypak_sync_orders";
  rows: (rows: T[]) => unknown[];
  saveFailed: string;
};

/**
 * One sync of a Citypak list (fixture data until Citypak authorises live access).
 * The person is checked with their own session (Courier permission). Saving then
 * runs with the server's service role – the save functions can't be called from
 * the browser – using the actor, account and mode decided here. A failure is
 * recorded by its own call, so it is kept even after a failed save rolled back.
 */
async function runSync<T>(stream: Stream<T>): Promise<ActionResult<SyncSummary>> {
  const ctx = await dispatchActionContext("courier");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const choice = chooseProvider();
  if (!choice.ok || !hasServiceRoleKey()) return { ok: false, error: "Citypak connection is not available yet." };
  const { provider } = choice;
  const admin = createAdminClient();
  const scope = { p_actor: ctx.profile.id, p_account: provider.account, p_mode: provider.mode };

  const fail = async (kind: string, progress: Progress): Promise<ActionResult<SyncSummary>> => {
    const { error } = await admin.rpc("citypak_record_failed_sync", {
      ...scope,
      p_error: kind,
      p_pages: progress.pages,
      p_fetched: progress.rows,
      p_stream: stream.name,
    });
    revalidatePath("/admin/citypak", "layout");
    if (error) {
      console.error("citypak sync: failure not recorded", { stream: stream.name, kind, code: error.code });
      return { ok: false, error: NOT_RECORDED };
    }
    if (kind === "save_failed") return { ok: false, error: stream.saveFailed };
    return { ok: false, error: SYNC_ERROR[kind] ?? SYNC_ERROR.internal };
  };

  const progress: Progress = { pages: 0, rows: 0 };
  let collected: Collected<T>;
  try {
    collected = await stream.collect(provider, progress);
  } catch (err) {
    return fail(err instanceof CitypakError ? err.kind : "internal", progress);
  }

  const { data, error } = await admin.rpc(stream.save, {
    ...scope,
    p_rows: stream.rows(collected.rows) as never,
    p_pages: collected.pages,
    p_rejected: collected.rejected,
    p_truncated: collected.truncated,
  });
  if (error || !data) return fail("save_failed", progress);
  revalidatePath("/admin/citypak", "layout");
  const r = data as SyncSummary;
  return r.outcome === "ok"
    ? { ok: true, message: stream.name === "orders" ? "Orders synced" : "Bulk uploads synced", data: r }
    : { ok: true, message: "Synced, but not completely", data: r };
}

/** Sync now on Bulk uploads. */
export async function syncCitypakBulkUploadsAction(): Promise<ActionResult<SyncSummary>> {
  return runSync({
    name: "bulk_uploads",
    collect: (provider, progress) => collectBulkUploads(provider, {}, progress),
    save: "citypak_sync_bulk_uploads",
    rows: toDbRows,
    saveFailed: SYNC_ERROR.save_failed,
  });
}

/** Sync now on Orders & waybills. */
export async function syncCitypakOrdersAction(): Promise<ActionResult<SyncSummary>> {
  return runSync({
    name: "orders",
    collect: (provider, progress) => collectOrders(provider, {}, progress),
    save: "citypak_sync_orders",
    rows: orderDbRows,
    saveFailed: SAVE_FAILED_ORDERS,
  });
}
