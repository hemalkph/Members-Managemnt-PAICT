"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { dispatchActionContext } from "@/lib/dispatch/access";
import type { ConfirmResult, LookupResult, Progress, ScanMode } from "@/lib/dispatch/packing";
import { cleanScan } from "@/lib/dispatch/scanner";
import { firstError, uuid } from "@/lib/validation";

const mode = z.enum(["pack", "verify"]);
const device = z.string().max(64).optional();

function revalidateRound(roundId: string) {
  revalidatePath(`/admin/dispatch/rounds/${roundId}`, "layout");
  revalidatePath("/admin/dispatch");
}

/** Look up a scanned code. Saves nothing except a record of failed scans. */
export async function lookupScanAction(input: { round_id: string; code: string; mode: ScanMode; device?: string }): Promise<ActionResult<LookupResult>> {
  const parsed = z.object({ round_id: uuid, code: z.string().max(200), mode, device }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid scan." };
  const ctx = await dispatchActionContext(parsed.data.mode);
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const code = cleanScan(parsed.data.code);
  if (!code) return { ok: false, error: "Nothing was scanned." };
  const { data, error } = await ctx.supabase.rpc("scan_lookup", {
    p_round: parsed.data.round_id,
    p_code: code,
    p_action: parsed.data.mode,
    p_device: parsed.data.device ?? null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true, data: data as unknown as LookupResult };
}

/** Confirm a parcel packed or verified. The same key always gets the same answer. */
export async function confirmScanAction(input: {
  parcel_id: string;
  round_id: string;
  mode: ScanMode;
  key: string;
  row_version: number;
  checked: string[];
  device?: string;
}): Promise<ActionResult<ConfirmResult>> {
  const parsed = z
    .object({
      parcel_id: uuid,
      round_id: uuid,
      mode,
      key: uuid,
      row_version: z.number().int().min(1),
      checked: z.array(uuid).max(30),
      device,
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const ctx = await dispatchActionContext(parsed.data.mode);
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const v = parsed.data;
  const { data, error } = await ctx.supabase.rpc("parcel_scan_confirm", {
    p_parcel: v.parcel_id,
    p_action: v.mode,
    p_idem: v.key,
    p_row_version: v.row_version,
    p_checked: v.checked,
    p_device: v.device ?? null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true, data: data as unknown as ConfirmResult };
}

/** Live counts for a round (parcels hold no personal data). */
export async function roundProgressAction(input: { round_id: string }): Promise<ActionResult<Progress>> {
  if (!uuid.safeParse(input.round_id).success) return { ok: false, error: "Round not found." };
  const ctx = await getActionContext({ page: "dispatch" });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { data, error } = await ctx.supabase
    .from("parcels")
    .select("registration_state, pack_state, on_hold, packed_by, verified_by")
    .eq("round_id", input.round_id)
    .neq("registration_state", "voided")
    .limit(20000);
  if (error) return { ok: false, error: friendlyDbError(error) };
  const me = ctx.profile.id;
  const rows = data ?? [];
  return {
    ok: true,
    data: {
      total: rows.length,
      registered: rows.filter((p) => p.registration_state === "registered").length,
      packed: rows.filter((p) => p.pack_state !== "planned").length,
      verified: rows.filter((p) => p.pack_state === "verified").length,
      onHold: rows.filter((p) => p.on_hold).length,
      mine: rows.filter((p) => p.packed_by === me || p.verified_by === me).length,
    },
  };
}

export async function reportProblemAction(input: { parcel_id: string; kind: string; note: string }): Promise<ActionResult> {
  const parsed = z
    .object({
      parcel_id: uuid,
      kind: z.enum(["missing_item", "damaged", "wrong_address", "label_problem", "cod_issue", "other"]),
      note: z.string().trim().max(300),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await getActionContext({ page: "dispatch", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { data: parcel } = await ctx.supabase.from("parcels").select("round_id").eq("id", parsed.data.parcel_id).maybeSingle();
  const { error } = await ctx.supabase.rpc("exception_open", {
    p_parcel: parsed.data.parcel_id,
    p_kind: parsed.data.kind,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (parcel) revalidateRound(parcel.round_id);
  return { ok: true, message: "Problem recorded – the parcel is on hold" };
}

export async function resolveProblemAction(input: { exception_id: string; round_id: string; note: string }): Promise<ActionResult> {
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!uuid.safeParse(input.exception_id).success || !uuid.safeParse(input.round_id).success) return { ok: false, error: "Not found." };
  const { error } = await ctx.supabase.rpc("exception_resolve", {
    p_exception: input.exception_id,
    p_resolution: "fixed",
    p_note: String(input.note ?? "").slice(0, 300),
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(input.round_id);
  return { ok: true, message: "Marked fixed – the parcel can be packed" };
}

export async function unpackParcelAction(input: { parcel_id: string; round_id: string; reason: string; row_version: number }): Promise<ActionResult> {
  const ctx = await dispatchActionContext("correct");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = z
    .object({ parcel_id: uuid, round_id: uuid, reason: z.string().trim().min(3, "Give a reason").max(300), row_version: z.number().int().min(1) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { error } = await ctx.supabase.rpc("parcel_unpack", {
    p_parcel: parsed.data.parcel_id,
    p_reason: parsed.data.reason,
    p_row_version: parsed.data.row_version,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateRound(parsed.data.round_id);
  return { ok: true, message: "Parcel moved back to “to pack”" };
}

/** Assign parcels to one packer (null = unassign), or split them evenly between several packers in list order. */
export async function assignParcelsAction(input: {
  round_id: string;
  parcel_ids: string[];
  packer_ids: (string | null)[];
}): Promise<ActionResult<{ assigned: number }>> {
  const parsed = z
    .object({ round_id: uuid, parcel_ids: z.array(uuid).min(1, "Choose parcels").max(5000), packer_ids: z.array(uuid.nullable()).min(1).max(20) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const ctx = await dispatchActionContext("plan");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const { round_id, parcel_ids, packer_ids } = parsed.data;
  const size = Math.ceil(parcel_ids.length / packer_ids.length);
  let assigned = 0;
  for (let i = 0; i < packer_ids.length; i++) {
    const chunk = parcel_ids.slice(i * size, (i + 1) * size);
    if (chunk.length === 0) continue;
    const { data, error } = await ctx.supabase.rpc("parcel_assign", { p_round: round_id, p_parcels: chunk, p_packer: packer_ids[i] });
    if (error) return { ok: false, error: friendlyDbError(error) };
    assigned += data ?? 0;
  }
  revalidateRound(round_id);
  return {
    ok: true,
    message: packer_ids[0] === null ? `Unassigned ${assigned} parcels` : `Assigned ${assigned} parcels`,
    data: { assigned },
  };
}
