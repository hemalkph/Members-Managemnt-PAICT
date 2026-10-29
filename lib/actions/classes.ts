"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import {
  batchSchema,
  centreSchema,
  examSchema,
  firstError,
  idSchema,
  type BatchInput,
  type CentreInput,
  type ExamInput,
} from "@/lib/validation";

function revalidateClasses() {
  revalidatePath("/admin/classes");
  revalidatePath("/admin/tasks");
  revalidatePath("/admin/papers");
  revalidatePath("/admin/reports");
  revalidatePath("/work/new");
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

/** Delete a batch (with its exams), an exam or a centre. Tagged work keeps existing without the tag. */
export async function deleteClassItemAction(input: {
  kind: "batch" | "exam" | "centre";
  id: string;
}): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "classes", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id: input.id });
  if (!parsed.success || !["batch", "exam", "centre"].includes(input.kind)) return { ok: false, error: "Not found." };

  const table = input.kind === "batch" ? "batches" : input.kind === "exam" ? "exams" : "centres";
  const { error } = await ctx.supabase.from(table).delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateClasses();
  return { ok: true, message: `${input.kind === "batch" ? "Batch" : input.kind === "exam" ? "Exam" : "Centre"} deleted` };
}
