"use server";

import { revalidatePath } from "next/cache";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { monthKeyToDate } from "@/lib/core/month";
import {
  firstError,
  tuteCountSchema,
  tuteIssueSchema,
  tuteJobStatusSchema,
  tutePrinterSchema,
  tutePrintJobSchema,
  tuteReceiveSchema,
  tuteSettingsSchema,
  type TuteCountInput,
  type TuteIssueInput,
  type TuteJobStatusInput,
  type TutePrinterInput,
  type TutePrintJobInput,
  type TuteReceiveInput,
  type TuteSettingsInput,
} from "@/lib/core/validation";

const editor = () => getActionContext({ page: "tutes", edit: true });

function revalidate() {
  revalidatePath("/admin/tutes");
  revalidatePath("/admin/fee-reminders");
}

/** Shelf count. The first count of a tute is its opening stock. */
export async function countTuteAction(input: TuteCountInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tuteCountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: change, error } = await ctx.supabase.rpc("tute_stock_count", {
    p_tute: parsed.data.tute_id,
    p_counted: parsed.data.counted,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return {
    ok: true,
    message: change === 0 ? "Count matches — nothing changed" : `Saved: ${parsed.data.counted} on hand (${change > 0 ? "+" : ""}${change})`,
  };
}

/** Copies given to a class, or damaged. */
export async function issueTuteAction(input: TuteIssueInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tuteIssueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: left, error } = await ctx.supabase.rpc("tute_stock_issue", {
    p_tute: parsed.data.tute_id,
    p_qty: parsed.data.qty,
    p_kind: parsed.data.kind,
    p_class: parsed.data.class_id,
    p_month: monthKeyToDate(parsed.data.month),
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  const what = parsed.data.kind === "damaged" ? "marked damaged" : "given out";
  return { ok: true, message: `${parsed.data.qty} ${what} · ${left} left` };
}

export async function saveTuteSettingsAction(input: TuteSettingsInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tuteSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("tute_settings_save", {
    p_tute: parsed.data.tute_id,
    p_pages: parsed.data.pages,
    p_reorder_level: parsed.data.reorder_level,
    p_print_batch: parsed.data.print_batch,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: "Settings saved" };
}

export async function savePrinterAction(input: TutePrinterInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tutePrinterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("tute_printer_save", {
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
    p_phone: parsed.data.phone,
    p_notes: parsed.data.notes,
    p_usual_days: parsed.data.usual_days,
    p_is_active: parsed.data.is_active,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: parsed.data.id ? "Printer updated" : `Added printer "${parsed.data.name}"` };
}

export async function createPrintJobAction(input: TutePrintJobInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tutePrintJobSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("tute_print_job_create", {
    p_tute: parsed.data.tute_id,
    p_qty: parsed.data.qty,
    p_printer: parsed.data.printer_id,
    p_due_date: parsed.data.due_date,
    p_cost: parsed.data.cost,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: `Print job for ${parsed.data.qty} copies added` };
}

export async function receivePrintJobAction(input: TuteReceiveInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tuteReceiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: total, error } = await ctx.supabase.rpc("tute_print_job_receive", {
    p_id: parsed.data.id,
    p_qty: parsed.data.qty,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: `Received ${parsed.data.qty} copies (${total} so far)` };
}

export async function setPrintJobStatusAction(input: TuteJobStatusInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tuteJobStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("tute_print_job_set_status", {
    p_id: parsed.data.id,
    p_status: parsed.data.status,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: parsed.data.status === "printing" ? "Marked as printing" : "Print job cancelled" };
}
