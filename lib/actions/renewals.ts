"use server";

import { revalidatePath } from "next/cache";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { monthKeyToDate } from "@/lib/core/month";
import {
  callOwnerSchema,
  firstError,
  followupOutcomeSchema,
  renewalSettingsSchema,
  type CallOwnerInput,
  type FollowupOutcomeInput,
  type RenewalSettingsInput,
} from "@/lib/core/validation";

const editor = () => getActionContext({ page: "fee_reminders", edit: true });

function revalidate() {
  revalidatePath("/admin/fee-reminders/renewals");
  revalidatePath("/admin/fee-reminders");
}

const OUTCOME_MESSAGE: Record<FollowupOutcomeInput["outcome"], string> = {
  no_answer: "Call noted. They'll be back on the list tomorrow.",
  promised: "Promise saved.",
  cant_afford: "Saved. The concession team will be told.",
  moved_class: "Marked as moved class.",
  dropped: "Marked as left the class.",
  excused: "Marked as excused.",
};

/** Record what an unpaid student said (or that they didn't answer). */
export async function setFollowupOutcomeAction(input: FollowupOutcomeInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = followupOutcomeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const { error } = await ctx.supabase.rpc("fee_followup_outcome", {
    p_class_id: d.class_id,
    p_due_month: monthKeyToDate(d.due_month),
    p_student_key: d.student_key,
    p_student_name: d.student_name,
    p_whatsapp_norm: d.whatsapp_norm,
    p_outcome: d.outcome,
    p_promised_by: d.promised_by ?? null,
    p_reason: d.reason ?? null,
    p_moved_to: d.moved_to ?? null,
    p_note: d.note ?? null,
    p_called: d.called,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: OUTCOME_MESSAGE[d.outcome] };
}

/** Choose who phones this class's unpaid students (null clears it). */
export async function setCallOwnerAction(input: CallOwnerInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = callOwnerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("fee_class_owner_set", {
    p_class: parsed.data.class_id,
    p_owner: parsed.data.owner_id,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: parsed.data.owner_id ? "Call owner saved." : "Call owner cleared." };
}

/** Change the renewal target (share of last month's students by a day of the month). */
export async function saveRenewalSettingsAction(input: RenewalSettingsInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = renewalSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("fee_renewal_settings_set", {
    p_due_day: parsed.data.due_day,
    p_target_pct: parsed.data.target_pct,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: `Target saved: ${parsed.data.target_pct}% by day ${parsed.data.due_day}.` };
}
