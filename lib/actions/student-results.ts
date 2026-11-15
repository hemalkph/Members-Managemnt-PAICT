"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import {
  examPartSchema,
  firstError,
  idSchema,
  resultsSaveSchema,
  type ExamPartInput,
  type ResultsSaveInput,
} from "@/lib/core/validation";

// Needs the Student results page with edit access (the database checks the same).
const editor = () => getActionContext({ page: "student_results", edit: true });

/** Add or change a part of an exam, e.g. "Paper I (MCQ)" out of 40. */
export async function saveExamPartAction(input: ExamPartInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = examPartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, exam_id, ...v } = parsed.data;

  const { error } = id
    ? await ctx.supabase.from("exam_parts").update(v).eq("id", id).eq("exam_id", exam_id)
    : await ctx.supabase.from("exam_parts").insert({ ...v, exam_id });
  if (error) return { ok: false, error: error.code === "23505" ? "This exam already has a part with that name." : friendlyDbError(error) };
  revalidatePath("/admin/student-results");
  return { ok: true, message: id ? "Part saved" : "Part added" };
}

/** Remove a part. Marks entered for it are removed too. */
export async function deleteExamPartAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Not found." };
  const { data, error } = await ctx.supabase.from("exam_parts").delete().eq("id", parsed.data.id).select("id");
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false, error: "Not found." };
  revalidatePath("/admin/student-results");
  return { ok: true, message: "Part removed" };
}

/** Save the changed rows of an exam's results sheet, all or nothing. */
export async function saveResultsAction(input: ResultsSaveInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = resultsSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { data: n, error } = await ctx.supabase.rpc("concession_results_save", {
    p_exam: parsed.data.exam_id,
    p_rows: parsed.data.rows,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/admin/student-results");
  return { ok: true, message: `Saved ${n} student${n === 1 ? "" : "s"}` };
}
