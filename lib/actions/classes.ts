"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import {
  batchSchema,
  centreSchema,
  examSchema,
  examSeriesSchema,
  firstError,
  idSchema,
  type BatchInput,
  type CentreInput,
  type ExamInput,
  type ExamSeriesInput,
} from "@/lib/core/validation";

function revalidateClasses() {
  revalidatePath("/admin/classes");
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/papers");
  revalidatePath("/admin/reports");
  revalidatePath("/work/new");
  revalidatePath("/admin/student-results");
}

function nameError(error: { code?: string } | null, what: string) {
  if (error?.code === "23505") return `There is already a ${what} with that name.`;
  return friendlyDbError(error);
}

export async function saveBatchAction(input: BatchInput): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "classes", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, name, is_active } = parsed.data;

  const { error } = id
    ? await ctx.supabase.from("batches").update({ name, is_active }).eq("id", id)
    : await ctx.supabase.from("batches").insert({ name, is_active });
  if (error) return { ok: false, error: nameError(error, "batch") };
  revalidateClasses();
  return { ok: true, message: id ? "Batch saved" : "Batch added" };
}

export async function saveExamAction(input: ExamInput): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "classes", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = examSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, batch_id, name, exam_date, is_active } = parsed.data;
  const row = { batch_id, name, exam_date: exam_date || null, is_active };

  const { error } = id
    ? await ctx.supabase.from("exams").update(row).eq("id", id)
    : await ctx.supabase.from("exams").insert(row);
  if (error) return { ok: false, error: nameError(error, "exam in this batch") };
  revalidateClasses();
  return { ok: true, message: id ? "Exam saved" : "Exam added" };
}

export async function saveSeriesAction(input: ExamSeriesInput): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "classes", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = examSeriesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, ...row } = parsed.data;

  const { error } = id
    ? await ctx.supabase.from("exam_series").update(row).eq("id", id)
    : await ctx.supabase.from("exam_series").insert(row);
  if (error) return { ok: false, error: nameError(error, "series with that name or code in this batch") };
  revalidateClasses();
  return { ok: true, message: id ? "Series saved" : "Series added" };
}

/** Add the next exam of a series ("RFP 06"), with the series' parts. */
export async function nextSeriesExamAction(input: { series_id: string; exam_date: string }): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "classes", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id: input.series_id });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.exam_date) ? input.exam_date : null;
  if (!parsed.success) return { ok: false, error: "Not found." };

  const { error } = await ctx.supabase.rpc("exam_series_next", { p_series: parsed.data.id, p_exam_date: date });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateClasses();
  return { ok: true, message: "Exam added with its parts" };
}

export async function saveCentreAction(input: CentreInput): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "classes", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = centreSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, name, is_active } = parsed.data;

  const { error } = id
    ? await ctx.supabase.from("centres").update({ name, is_active }).eq("id", id)
    : await ctx.supabase.from("centres").insert({ name, is_active });
  if (error) return { ok: false, error: nameError(error, "centre") };
  revalidateClasses();
  return { ok: true, message: id ? "Centre saved" : "Centre added" };
}

/** Delete a batch (with its exams), a series (once its exams are gone), an exam or a centre. Tagged work keeps existing without the tag. */
export async function deleteClassItemAction(input: {
  kind: "batch" | "series" | "exam" | "centre";
  id: string;
}): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "classes", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id: input.id });
  const TABLE = { batch: "batches", series: "exam_series", exam: "exams", centre: "centres" } as const;
  const LABEL = { batch: "Batch", series: "Series", exam: "Exam", centre: "Centre" } as const;
  if (!parsed.success || !(input.kind in TABLE)) return { ok: false, error: "Not found." };

  const { error } = await ctx.supabase.from(TABLE[input.kind]).delete().eq("id", parsed.data.id);
  if (error?.code === "23503" && input.kind === "series") {
    return { ok: false, error: "Delete or move the exams of this series first, or switch the series to inactive." };
  }
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateClasses();
  return { ok: true, message: `${LABEL[input.kind]} deleted` };
}
