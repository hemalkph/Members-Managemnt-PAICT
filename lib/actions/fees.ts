"use server";

import { revalidatePath } from "next/cache";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { monthKeyToDate, todayISO } from "@/lib/core/month";
import { recordRenewal } from "@/lib/fees/renewals-queries";
import {
  feeFollowupSchema,
  feeMonthDeleteSchema,
  feeMonthImportSchema,
  feeTemplateSchema,
  firstError,
  idSchema,
  type FeeFollowupInput,
  type FeeMonthImportInput,
  type FeeTemplateInput,
} from "@/lib/core/validation";

const editor = () => getActionContext({ page: "fee_reminders", edit: true });

function revalidate() {
  revalidatePath("/admin/fee-reminders");
}

/**
 * Hybrid single-class OR multi-class monthly paid list import.
 * Enforces strict non-overlap: two detected groups in the same file cannot target the same class.
 */
export async function importFeeMonthAction(
  input: FeeMonthImportInput,
): Promise<ActionResult<{ importedClasses: { id: string; count: number }[]; primaryClassId: string }>> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = feeMonthImportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { batch_id, month, file_name, groups } = parsed.data;

  // Guard against accidental overlap: verify no duplicate target class IDs or duplicate new names.
  const seenTargets = new Set<string>();
  for (const g of groups) {
    const key = g.class_id ? `id:${g.class_id}` : `new:${g.new_class_name.trim().toLowerCase()}`;
    if (seenTargets.has(key)) {
      return {
        ok: false,
        error: "Two class groups in this upload are mapped to the same target class. Map each class separately so student lists do not overlap.",
      };
    }
    seenTargets.add(key);
  }

  // Load existing classes in this batch so creating a new class by an existing name reuses or flags cleanly.
  const { data: existingClasses } = await ctx.supabase
    .from("fee_classes")
    .select("id, name")
    .eq("batch_id", batch_id);
  const existingByLower = new Map((existingClasses ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));

  const monthDate = monthKeyToDate(month);
  const importedClasses: { id: string; count: number }[] = [];
  const usedClassIds = new Set<string>();

  for (const group of groups) {
    let targetClassId = group.class_id;
    if (!targetClassId) {
      const cleanName = group.new_class_name.trim();
      const existingId = existingByLower.get(cleanName.toLowerCase());
      if (existingId) {
        targetClassId = existingId;
      } else {
        const { data: createdId, error: createErr } = await ctx.supabase.rpc("fee_class_save", {
          p_id: null,
          p_batch_id: batch_id,
          p_name: cleanName,
          p_is_active: true,
        });
        if (createErr) return { ok: false, error: friendlyDbError(createErr) };
        targetClassId = createdId;
        existingByLower.set(cleanName.toLowerCase(), createdId);
      }
    }

    if (usedClassIds.has(targetClassId)) {
      return {
        ok: false,
        error: "Multiple class groups resolved to the same class. Choose separate target classes to prevent overlap.",
      };
    }
    usedClassIds.add(targetClassId);

    const { data: count, error: impErr } = await ctx.supabase.rpc("fee_month_replace_import", {
      p_class_id: targetClassId,
      p_month: monthDate,
      p_file_name: file_name,
      p_raw_count: group.raw_row_count,
      p_duplicates_merged: group.duplicates_merged,
      p_rows: group.rows.map((r) => ({
        ...r,
        amount: r.amount !== null ? String(r.amount) : null,
      })),
    });
    if (impErr) return { ok: false, error: friendlyDbError(impErr) };
    importedClasses.push({ id: targetClassId, count });
  }

  // Renewals: record this month's numbers and who has now paid (never fails the upload).
  if (month === todayISO().slice(0, 7)) {
    for (const c of importedClasses) await recordRenewal(ctx.supabase, { id: c.id, batchId: batch_id }, month);
    revalidatePath("/admin/fee-reminders/renewals");
  }

  revalidate();
  const totalStudents = importedClasses.reduce((sum, x) => sum + x.count, 0);
  return {
    ok: true,
    message:
      importedClasses.length === 1
        ? `Saved ${totalStudents} paid student${totalStudents === 1 ? "" : "s"} for ${month}`
        : `Saved ${totalStudents} paid students across ${importedClasses.length} classes for ${month}`,
    data: { importedClasses, primaryClassId: importedClasses[0].id },
  };
}

/** Delete one uploaded month snapshot for a class. */
export async function deleteFeeMonthAction(input: { class_id: string; month: string }): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = feeMonthDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("fee_month_delete_import", {
    p_class_id: parsed.data.class_id,
    p_month: monthKeyToDate(parsed.data.month),
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: `Removed ${parsed.data.month} paid list` };
}

/** Record WhatsApp sent, change follow-up status (pending/messaged/excused/dropped), or save label/note. */
export async function setFeeFollowupAction(
  input: FeeFollowupInput,
): Promise<ActionResult<{ messageCount: number; lastMessagedAt: string | null; status: string }>> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = feeFollowupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const d = parsed.data;
  const { data, error } = await ctx.supabase.rpc("fee_followup_set", {
    p_class_id: d.class_id,
    p_due_month: monthKeyToDate(d.due_month),
    p_student_key: d.student_key,
    p_student_name: d.student_name,
    p_email_norm: d.email_norm,
    p_whatsapp_norm: d.whatsapp_norm,
    p_status: d.status,
    p_label: d.label === undefined ? null : d.label,
    p_note: d.note === undefined ? null : d.note,
    p_template_id: d.template_id ? d.template_id : null,
    p_increment_message: Boolean(d.increment_message),
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return {
    ok: true,
    data: {
      messageCount: data.message_count,
      lastMessagedAt: data.last_messaged_at,
      status: data.status,
    },
  };
}

/** Create or update a customizable WhatsApp message template (with emojis & placeholders). */
export async function saveFeeTemplateAction(input: FeeTemplateInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = feeTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: id, error } = await ctx.supabase.rpc("fee_template_save", {
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
    p_body: parsed.data.body,
    p_is_default: parsed.data.is_default,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return {
    ok: true,
    message: parsed.data.id ? `Saved template "${parsed.data.name}"` : `Created template "${parsed.data.name}"`,
    data: { id },
  };
}

/** Delete a WhatsApp template. */
export async function deleteFeeTemplateAction(id: string): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("fee_template_delete", { p_id: parsed.data.id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: "Template deleted" };
}
