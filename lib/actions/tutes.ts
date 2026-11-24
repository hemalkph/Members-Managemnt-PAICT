"use server";

import { revalidatePath } from "next/cache";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { monthKeyToDate } from "@/lib/core/month";
import { TUTE_COVERS_BUCKET } from "@/lib/core/storage";
import {
  firstError,
  idSchema,
  tuteCountManySchema,
  tuteCountSchema,
  tuteCoverSchema,
  tuteHandOutSchema,
  tuteIssueSchema,
  tuteJobStatusSchema,
  tutePrinterSchema,
  tutePrintJobSchema,
  tutePrintJobUpdateSchema,
  tuteReceiveSchema,
  tuteSaveSchema,
  type TuteCountInput,
  type TuteCountManyInput,
  type TuteCoverInput,
  type TuteHandOutInput,
  type TuteIssueInput,
  type TuteJobStatusInput,
  type TutePrinterInput,
  type TutePrintJobInput,
  type TutePrintJobUpdateInput,
  type TuteReceiveInput,
  type TuteSaveInput,
} from "@/lib/core/validation";

const editor = () => getActionContext({ page: "tutes", edit: true });

function revalidate() {
  revalidatePath("/admin/tutes");
  revalidatePath("/admin/fee-reminders");
  revalidatePath("/library");
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
    message:
      change === 0
        ? "Count matches — nothing changed"
        : `Saved: ${parsed.data.counted} on hand (${change > 0 ? "+" : ""}${change})`,
  };
}

/** Count all: saves each shelf count in turn and stops at the first problem. */
export async function countTutesAction(input: TuteCountManyInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tuteCountManySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  let saved = 0;
  for (const c of parsed.data) {
    const { error } = await ctx.supabase.rpc("tute_stock_count", {
      p_tute: c.tute_id,
      p_counted: c.counted,
      p_note: "",
    });
    if (error) {
      if (saved > 0) revalidate();
      return {
        ok: false,
        error: saved > 0 ? `${saved} saved, then: ${friendlyDbError(error)}` : friendlyDbError(error),
      };
    }
    saved += 1;
  }
  revalidate();
  return { ok: true, message: `${saved} count${saved === 1 ? "" : "s"} saved` };
}

/** Hand out by class: copies of several tutes to one class, saved in turn. */
export async function handOutTutesAction(input: TuteHandOutInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tuteHandOutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const month = monthKeyToDate(parsed.data.month);
  let copies = 0;
  let saved = 0;
  for (const it of parsed.data.items) {
    const { error } = await ctx.supabase.rpc("tute_stock_issue", {
      p_tute: it.tute_id,
      p_qty: it.qty,
      p_kind: "class_issue",
      p_class: parsed.data.class_id,
      p_month: month,
      p_note: "",
    });
    if (error) {
      if (saved > 0) revalidate();
      return {
        ok: false,
        error:
          saved > 0
            ? `${saved} tute${saved === 1 ? "" : "s"} saved, then: ${friendlyDbError(error)}`
            : friendlyDbError(error),
      };
    }
    copies += it.qty;
    saved += 1;
  }
  revalidate();
  return { ok: true, message: `${copies} copies of ${saved} tute${saved === 1 ? "" : "s"} given out` };
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

/** Add a tute to the shelf, or edit one (name, code, in use, settings, Paper Library PDF). */
export async function saveTuteAction(input: TuteSaveInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tuteSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: tid, error } = await ctx.supabase.rpc("tute_save", {
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
    p_code: parsed.data.code,
    p_is_active: parsed.data.is_active,
    p_pages: parsed.data.pages,
    p_reorder_level: parsed.data.reorder_level,
    p_print_batch: parsed.data.print_batch,
    p_paper_id: parsed.data.paper_id,
    p_opening_stock: parsed.data.id ? null : (parsed.data.opening_stock ?? null),
  });
  if (error) return { ok: false, error: friendlyDbError(error) };

  let scheduled = 0;
  const classIds = !parsed.data.id ? [...new Set(parsed.data.schedule_class_ids ?? [])] : [];
  if (tid && classIds.length > 0 && parsed.data.schedule_month) {
    const monthDate = monthKeyToDate(parsed.data.schedule_month);
    for (const classId of classIds) {
      const { error: attachErr } = await ctx.supabase.rpc("class_month_tute_attach", {
        p_class_id: classId,
        p_month: monthDate,
        p_tute_id: tid,
        p_note: "",
      });
      if (attachErr) {
        revalidate();
        return {
          ok: false,
          error: `Added "${parsed.data.name}", but could not schedule it: ${friendlyDbError(attachErr)}`,
        };
      }
      scheduled += 1;
    }
  }

  revalidate();
  const savedId = tid ?? parsed.data.id ?? "";
  if (parsed.data.id) return { ok: true, message: "Tute saved", data: { id: savedId } };
  const extras: string[] = [];
  if (parsed.data.opening_stock && parsed.data.opening_stock > 0) extras.push(`${parsed.data.opening_stock} on hand`);
  if (scheduled > 0) extras.push(`scheduled for ${scheduled} class${scheduled === 1 ? "" : "es"}`);
  return {
    ok: true,
    message: extras.length > 0 ? `Added "${parsed.data.name}" (${extras.join(" · ")})` : `Added "${parsed.data.name}"`,
    data: { id: savedId },
  };
}

/** Delete a tute that has no stock, print or post history. */
export async function deleteTuteAction(id: string): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: existing } = await ctx.supabase
    .from("class_tutes")
    .select("cover_path")
    .eq("id", parsed.data.id)
    .maybeSingle();

  const { error } = await ctx.supabase.rpc("class_tute_delete", { p_id: parsed.data.id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (existing?.cover_path) {
    await ctx.supabase.storage.from(TUTE_COVERS_BUCKET).remove([existing.cover_path]);
  }
  revalidate();
  return { ok: true, message: "Tute deleted" };
}

/** Save or remove a tute's cover photo after client upload to tute-covers/<tute_id>/... */
export async function setTuteCoverAction(input: TuteCoverInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tuteCoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { tute_id, path } = parsed.data;
  if (path && (!path.startsWith(`${tute_id}/`) || path.includes(".."))) {
    return { ok: false, error: "Invalid cover image." };
  }

  const { data: oldPath, error } = await ctx.supabase.rpc("tute_set_cover", {
    p_id: tute_id,
    p_path: path,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };

  if (oldPath && oldPath !== path) {
    await ctx.supabase.storage.from(TUTE_COVERS_BUCKET).remove([oldPath]);
  }
  revalidate();
  return { ok: true, message: path ? "Cover photo updated" : "Cover photo removed" };
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

export async function updatePrintJobAction(input: TutePrintJobUpdateInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tutePrintJobUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("tute_print_job_update", {
    p_id: parsed.data.id,
    p_qty: parsed.data.qty,
    p_printer: parsed.data.printer_id,
    p_due_date: parsed.data.due_date,
    p_cost: parsed.data.cost,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidate();
  return { ok: true, message: "Print job updated" };
}

export async function receivePrintJobAction(input: TuteReceiveInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = tuteReceiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: total, error } = await ctx.supabase.rpc("tute_print_job_receive", {
    p_id: parsed.data.id,
    p_qty: parsed.data.qty,
    p_cost: parsed.data.cost ?? null,
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
