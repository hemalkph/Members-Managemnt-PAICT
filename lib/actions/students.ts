"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import {
  CONCESSION_BUCKET,
  concessionCardSchema,
  concessionFilesSchema,
  concessionGuardianSchema,
  concessionStudentSchema,
  firstError,
  idSchema,
  type ConcessionCardInput,
  type ConcessionFilesInput,
  type ConcessionGuardianInput,
  type ConcessionStudentInput,
} from "@/lib/core/validation";
import { CARD_LABEL, STATUS_LABEL } from "@/lib/students/rules";

// Every write needs the Students page with edit access (the database checks the same).
const editor = () => getActionContext({ page: "students", edit: true });

function revalidateStudents(id?: string) {
  revalidatePath("/admin/students");
  if (id) revalidatePath(`/admin/students/${id}`);
}

/** Register a student, or change their details. */
export async function saveConcessionStudentAction(input: ConcessionStudentInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = concessionStudentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { expected_updated_at, ...v } = parsed.data;

  const { data: id, error } = await ctx.supabase.rpc("concession_student_save", {
    p: v,
    p_expected_updated_at: expected_updated_at || null,
  });
  if (error || !id) return { ok: false, error: friendlyDbError(error) };
  revalidateStudents(id);
  return { ok: true, message: v.id ? "Student saved" : "Student registered", data: { id } };
}

/** Verify, change the card type, put under review or end. */
export async function setConcessionCardAction(input: ConcessionCardInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = concessionCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const { error } = await ctx.supabase.rpc("concession_student_set_card", {
    p_id: v.id,
    p_card: v.card_type,
    p_status: v.status,
    p_note: v.note,
    p_expected_updated_at: v.expected_updated_at || null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateStudents(v.id);
  return { ok: true, message: `${STATUS_LABEL[v.status]} · ${CARD_LABEL[v.card_type]}` };
}

/** Delete a student added by mistake (never verified), with their files. */
export async function deleteConcessionStudentAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Student not found." };

  const { data: paths, error } = await ctx.supabase.rpc("concession_student_delete", { p_id: parsed.data.id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (paths?.length) await ctx.supabase.storage.from(CONCESSION_BUCKET).remove(paths);
  revalidateStudents();
  return { ok: true, message: "Student deleted" };
}

/** Add or edit a parent / guardian. */
export async function saveGuardianAction(input: ConcessionGuardianInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = concessionGuardianSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, student_id, ...v } = parsed.data;
  const row = { ...v, phone: v.phone || null };

  const { error } = id
    ? await ctx.supabase.from("concession_guardians").update(row).eq("id", id).eq("student_id", student_id)
    : await ctx.supabase.from("concession_guardians").insert({ ...row, student_id });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateStudents(student_id);
  return { ok: true, message: id ? "Saved" : "Parent added" };
}

export async function deleteGuardianAction(input: { id: string; student_id: string }): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id: input.id });
  const student = idSchema.safeParse({ id: input.student_id });
  if (!parsed.success || !student.success) return { ok: false, error: "Not found." };

  const { data, error } = await ctx.supabase.from("concession_guardians").delete().eq("id", parsed.data.id).select("id");
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false, error: "Not found." };
  revalidateStudents(student.data.id);
  return { ok: true, message: "Removed" };
}

/** Save certificate files already uploaded to storage. All or nothing. */
export async function addConcessionFilesAction(input: ConcessionFilesInput): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = concessionFilesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;
  const paths = v.files.map((f) => f.storage_path);
  if (paths.some((p) => !p.startsWith(`${v.student_id}/`) || p.includes(".."))) return { ok: false, error: "Invalid file." };

  const { error } = await ctx.supabase
    .from("concession_documents")
    .insert(v.files.map((f) => ({ ...f, student_id: v.student_id, uploaded_by: ctx.profile.id })));
  if (error) {
    await ctx.supabase.storage.from(CONCESSION_BUCKET).remove(paths);
    return { ok: false, error: friendlyDbError(error) };
  }
  revalidateStudents(v.student_id);
  return { ok: true, message: v.files.length === 1 ? "Certificate added" : `${v.files.length} files added` };
}

export async function deleteConcessionFileAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "File not found." };

  const { data, error } = await ctx.supabase
    .from("concession_documents")
    .delete()
    .eq("id", parsed.data.id)
    .select("storage_path, student_id");
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false, error: "File not found." };
  await ctx.supabase.storage.from(CONCESSION_BUCKET).remove([data[0].storage_path]);
  revalidateStudents(data[0].student_id);
  return { ok: true, message: "File removed" };
}
