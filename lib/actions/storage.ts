"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { formatBytes } from "@/lib/format";
import { cleanupPaperFiles } from "@/lib/paper-cleanup";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

/** Main admins: how many days after hand-over paper files are kept. */
export async function setPaperFileDaysAction(input: { days: number }): Promise<ActionResult> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const days = Number(input.days);
  if (!Number.isInteger(days) || days < 1 || days > 365) return { ok: false, error: "Choose between 1 and 365 days." };
  const { error } = await ctx.supabase.rpc("set_paper_file_days", { p_days: days });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/admin/papers");
  return { ok: true, message: `Paper files are kept ${days} day${days === 1 ? "" : "s"} after hand-over` };
}

/** Main admins: run the clean-up now instead of waiting for tonight. */
export async function cleanupPaperFilesNowAction(): Promise<ActionResult> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!hasServiceRoleKey()) return { ok: false, error: "The clean-up needs SUPABASE_SERVICE_ROLE_KEY on the server." };
  try {
    const r = await cleanupPaperFiles(createAdminClient());
    revalidatePath("/admin/papers");
    return {
      ok: true,
      message:
        r.files > 0
          ? `Deleted ${r.files} file${r.files === 1 ? "" : "s"} from ${r.papers} paper${r.papers === 1 ? "" : "s"} (${formatBytes(r.bytes)} freed)`
          : `Nothing to delete – no handed-over paper is older than ${r.days} days`,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
