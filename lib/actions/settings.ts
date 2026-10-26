"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";

const budgetSchema = z.object({
  monthly_budget: z
    .number({ error: "Enter an amount" })
    .min(0, "Budget can't be negative")
    .max(1_000_000_000, "That amount is too large"),
});

/** Main admins set the monthly team budget used on the Analytics page. */
export async function updateMonthlyBudgetAction(input: { monthly_budget: number }): Promise<ActionResult> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid amount" };

  const { error } = await ctx.supabase
    .from("app_settings")
    .update({ monthly_budget: Math.round(parsed.data.monthly_budget * 100) / 100, updated_by: ctx.profile.id })
    .eq("id", true);
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidatePath("/admin/analytics");
  return { ok: true, message: "Monthly budget saved" };
}
