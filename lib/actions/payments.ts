"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { monthKeyToDate, monthLabel } from "@/lib/month";
import {
  closeMonthSchema,
  firstError,
  markPaidSchema,
  reopenMonthSchema,
  type CloseMonthInput,
  type MarkPaidInput,
} from "@/lib/validation";

function revalidatePayments() {
  revalidatePath("/admin/payments");
  revalidatePath("/admin/analytics");
  revalidatePath("/admin/activity");
  revalidatePath("/payslips");
}

/** Close a month: locks its work and creates a payslip for every member owed money. */
export async function closeMonthAction(input: CloseMonthInput): Promise<ActionResult<{ count: number }>> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = closeMonthSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data, error } = await ctx.supabase.rpc("close_pay_month", {
    p_month: monthKeyToDate(parsed.data.month),
    p_note: parsed.data.note || null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidatePayments();
  revalidatePath("/admin/review");
  const count = data ?? 0;
  return {
    ok: true,
    message: `${monthLabel(parsed.data.month)} closed · ${count} payslip${count === 1 ? "" : "s"} created`,
    data: { count },
  };
}

/** Reopen a closed month (only while nobody is marked as paid). */
export async function reopenMonthAction(input: { month: string }): Promise<ActionResult> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = reopenMonthSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("reopen_pay_month", { p_month: monthKeyToDate(parsed.data.month) });
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidatePayments();
  revalidatePath("/admin/review");
  return { ok: true, message: `${monthLabel(parsed.data.month)} reopened` };
}

/** Mark payouts as paid (date + optional bank reference) or back to not paid. */
export async function markPaidAction(input: MarkPaidInput): Promise<ActionResult<{ count: number }>> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const { data, error } = await ctx.supabase.rpc("set_payouts_paid", {
    p_ids: v.ids,
    p_paid: v.paid,
    p_paid_on: v.paid ? v.paid_on : null,
    p_reference: v.paid ? v.reference || null : null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidatePayments();
  const count = data ?? 0;
  if (count === 0) {
    return { ok: true, message: v.paid ? "Already marked as paid" : "Already marked as not paid", data: { count } };
  }
  return {
    ok: true,
    message: `${count} member${count === 1 ? "" : "s"} marked as ${v.paid ? "paid" : "not paid"}`,
    data: { count },
  };
}
