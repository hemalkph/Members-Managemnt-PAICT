"use server";

import { revalidatePath } from "next/cache";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { dayOffSchema, firstError, idSchema, type DayOffInput } from "@/lib/core/validation";

function revalidate() {
  revalidatePath("/week");
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/papers");
}

/** Mark days away (your own; admins can pass someone else's user_id). */
export async function addDayOffAction(input: DayOffInput): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = dayOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("day_off_add", {
    p_from: parsed.data.from,
    p_to: parsed.data.to,
    p_note: parsed.data.note,
    p_user: parsed.data.user_id ?? null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: "Days off saved." };
}

export async function deleteDayOffAction(id: string): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("day_off_delete", { p_id: parsed.data.id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: "Days off removed." };
}
