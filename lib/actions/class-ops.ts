"use server";

import { revalidatePath } from "next/cache";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { filterNewTutePairs } from "@/lib/class-ops/helpers";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { monthKeyToDate, monthLabel } from "@/lib/core/month";
import {
  classPaidCountSchema,
  classTutesAssignSchema,
  classTutesCopySchema,
  feeClassSchema,
  firstError,
  idSchema,
  type ClassPaidCountInput,
  type ClassTutesAssignInput,
  type ClassTutesCopyInput,
  type FeeClassInput,
} from "@/lib/core/validation";

const editor = () => getActionContext({ page: "class_ops", edit: true });

// Classes feed Fee reminders, Tute stock and Speed Post too.
function revalidate() {
  revalidatePath("/admin/class-ops");
  revalidatePath("/admin/fee-reminders");
  revalidatePath("/admin/tutes");
  revalidatePath("/admin/post");
}

/** Add or edit a class (batch, name, Physical / Online / Both, in use). */
export async function saveClassAction(input: FeeClassInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = feeClassSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: id, error } = await ctx.supabase.rpc("fee_class_save", {
    p_id: parsed.data.id ?? null,
    p_batch_id: parsed.data.batch_id,
    p_name: parsed.data.name,
    p_is_active: parsed.data.is_active,
    p_mode: parsed.data.mode,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return {
    ok: true,
    message: parsed.data.id ? `Updated class "${parsed.data.name}"` : `Added class "${parsed.data.name}"`,
    data: { id },
  };
}

/** Delete a class and its uploaded paid lists. */
export async function deleteClassAction(id: string): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("fee_class_delete", { p_id: parsed.data.id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: "Class removed" };
}

/** Today's "paid so far" for a class; tute forecasts use it like an upload. */
export async function saveClassPaidCountAction(input: ClassPaidCountInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = classPaidCountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("class_paid_count_save", {
    p_class: parsed.data.class_id,
    p_count: parsed.data.count,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: `Saved: ${parsed.data.count} paid so far` };
}

/** Undo the most recent typed paid count (within the last 10 minutes). */
export async function undoClassPaidCountAction(classId: string): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id: classId });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: undone, error } = await ctx.supabase.rpc("class_paid_count_undo", {
    p_class: parsed.data.id,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: `Undid typed count (${undone})` };
}

/**
 * Schedule every newly picked tute for every picked class in a month.
 * Skips already-scheduled pairs so activity logs and toast counts stay exact.
 */
export async function assignClassTutesAction(input: ClassTutesAssignInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = classTutesAssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const month = monthKeyToDate(parsed.data.month);
  const uniqueClasses = [...new Set(parsed.data.class_ids)];
  const uniqueTutes = [...new Set(parsed.data.tute_ids)];

  const { data: existing } = await ctx.supabase
    .from("class_month_tutes")
    .select("class_id, tute_id")
    .eq("month", month)
    .in("class_id", uniqueClasses)
    .in("tute_id", uniqueTutes);

  const existingKeys = new Set((existing ?? []).map((r) => `${r.class_id}:${r.tute_id}`));
  const pairs = filterNewTutePairs(uniqueClasses, uniqueTutes, existingKeys);

  if (pairs.length === 0) {
    return { ok: true, message: "Already scheduled" };
  }

  let done = 0;
  for (const { classId, tuteId } of pairs) {
    const { error } = await ctx.supabase.rpc("class_month_tute_attach", {
      p_class_id: classId,
      p_month: month,
      p_tute_id: tuteId,
      p_note: "",
    });
    if (error) {
      if (done > 0) revalidate();
      return { ok: false, error: `${done} scheduled, then: ${friendlyDbError(error)}` };
    }
    done += 1;
  }
  revalidate();
  return { ok: true, message: `Scheduled ${done} tute${done === 1 ? "" : "s"}` };
}

/** Copy one class's tute plan from one month into another. */
export async function copyClassTutesAction(input: ClassTutesCopyInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = classTutesCopySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: added, error } = await ctx.supabase.rpc("class_month_tutes_copy", {
    p_class: parsed.data.class_id,
    p_from_month: monthKeyToDate(parsed.data.from_month),
    p_to_month: monthKeyToDate(parsed.data.to_month),
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  if (!added) {
    return { ok: true, message: `All tutes from ${monthLabel(parsed.data.from_month, "short")} are already scheduled` };
  }
  return {
    ok: true,
    message: `Copied ${added} tute${added === 1 ? "" : "s"} into ${monthLabel(parsed.data.to_month, "short")}`,
  };
}

/** Take one tute off one class's month. */
export async function removeClassTuteAction(id: string): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("class_month_tute_remove", { p_id: parsed.data.id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: "Tute removed from the month" };
}
