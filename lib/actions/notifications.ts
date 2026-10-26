"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { notificationIdsSchema } from "@/lib/validation";

/** Mark some (or, with no ids, all) of your notifications as read. */
export async function markNotificationsReadAction(input: { ids?: number[] } = {}): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = notificationIdsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid notifications" };

  let query = ctx.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", ctx.profile.id)
    .is("read_at", null);
  if (parsed.data.ids) query = query.in("id", parsed.data.ids);
  const { error } = await query;
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidatePath("/notifications");
  return { ok: true };
}

/** Delete your read notifications. */
export async function clearReadNotificationsAction(): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const { error } = await ctx.supabase
    .from("notifications")
    .delete()
    .eq("user_id", ctx.profile.id)
    .not("read_at", "is", null);
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidatePath("/notifications");
  return { ok: true, message: "Read notifications cleared" };
}
