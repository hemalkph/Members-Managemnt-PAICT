"use server";

import { revalidatePath } from "next/cache";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { monthKeyToDate, monthLabel } from "@/lib/core/month";
import { classFeeSchema, firstError, type ClassFeeInput } from "@/lib/core/validation";

/** Set or change a class's monthly fee from a month onwards (main admins only). */
export async function setClassFeeAction(input: ClassFeeInput): Promise<ActionResult> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = classFeeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("class_fee_set", {
    p_class: parsed.data.class_id,
    p_from_month: monthKeyToDate(parsed.data.from_month),
    p_fee: parsed.data.fee,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidatePath("/admin/money");
  return { ok: true, message: `Fee saved from ${monthLabel(parsed.data.from_month)}.` };
}
