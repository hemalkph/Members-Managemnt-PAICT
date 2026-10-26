"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { monthKeyToDate, monthLabel } from "@/lib/month";
import {
  deadlineSettingsSchema,
  firstError,
  monthDeadlineSchema,
  type DeadlineSettingsInput,
  type MonthDeadlineInput,
} from "@/lib/validation";

function revalidateDeadlines() {
  revalidatePath("/admin/payments");
  revalidatePath("/dashboard");
  revalidatePath("/work/new");
}

/** Main admins: the normal deadline rule ("day N of the next month"). */
export async function updateDeadlineSettingsAction(input: DeadlineSettingsInput): Promise<ActionResult> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = deadlineSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const { error } = await ctx.supabase
    .from("app_settings")
    .update({
      deadline_enabled: v.enabled,
      deadline_day: v.day,
      reminder_days: v.reminderDays,
      updated_by: ctx.profile.id,
    })
    .eq("id", true);
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidateDeadlines();
  return { ok: true, message: v.enabled ? "Deadline rule saved" : "Monthly deadline turned off" };
}

/** Main admins: give one month a different last day (or back to the normal rule). */
export async function setMonthDeadlineAction(input: MonthDeadlineInput): Promise<ActionResult> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = monthDeadlineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { month, lastDay } = parsed.data;

  const { error } = await ctx.supabase.rpc("set_month_deadline", {
    p_month: monthKeyToDate(month),
    p_last_day: lastDay || null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidateDeadlines();
  return {
    ok: true,
    message: lastDay ? `${monthLabel(month)} deadline changed` : `${monthLabel(month)} uses the normal deadline again`,
  };
}
