"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { PAPERS_BUCKET } from "@/lib/papers";
import {
  firstError,
  idSchema,
  paperFileSchema,
  paperSchema,
  paperStageUpdateSchema,
  type PaperFileInput,
  type PaperInput,
} from "@/lib/validation";

function revalidatePapers(id?: string) {
  revalidatePath("/admin/papers");
  revalidatePath("/tasks");
  revalidatePath("/admin/tasks");
  if (id) revalidatePath(`/papers/${id}`);
}

/** Admins: add a paper or tute with its stages (owners, due dates, skipped stages). */
export async function createPaperAction(input: PaperInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getActionContext({ admin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = paperSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const { data, error } = await ctx.supabase.rpc("create_paper", {
    p_title: v.title,
    p_kind: v.kind,
    p_exam: v.exam_id || null,
    p_notes: v.notes || null,
    p_stages: v.stages.map((s) => ({
      stage: s.stage,
      owner_id: s.skip ? null : s.owner_id || null,
      due_date: s.skip ? null : s.due_date || null,
      skip: s.skip,
    })),
  });
  if (error || !data) return { ok: false, error: friendlyDbError(error) };
  revalidatePapers(data);
  return { ok: true, message: "Paper added – the first stage has started", data: { id: data } };
}

/** Admins: change a stage's owner / due date, skip it or mark it done. */
export async function updatePaperStageAction(input: {
  stage_id: string;
  owner_id: string;
  due_date: string;
  action: "save" | "skip" | "done";
  paper_id: string;
}): Promise<ActionResult> {
  const ctx = await getActionContext({ admin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = paperStageUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const { error } = await ctx.supabase.rpc("update_paper_stage", {
    p_stage: v.stage_id,
    p_owner: v.owner_id || null,
    p_due: v.due_date || null,
    p_action: v.action,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePapers(input.paper_id);
  return {
    ok: true,
    message: v.action === "skip" ? "Stage skipped" : v.action === "done" ? "Stage marked as done" : "Stage saved",
  };
}

/** Admins: cancel, restart or delete a paper. */
export async function setPaperStatusAction(input: {
  id: string;
  status: "cancelled" | "in_progress" | "deleted";
}): Promise<ActionResult> {
  const ctx = await getActionContext({ admin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id: input.id });
  if (!parsed.success || !["cancelled", "in_progress", "deleted"].includes(input.status)) {
    return { ok: false, error: "Paper not found." };
  }

  let paths: string[] = [];
  if (input.status === "deleted") {
    const { data } = await ctx.supabase.from("paper_files").select("storage_path").eq("paper_id", input.id);
    paths = (data ?? []).map((f) => f.storage_path);
  }
  const { error } = await ctx.supabase.rpc("set_paper_status", { p_paper: input.id, p_status: input.status });
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (paths.length > 0) await ctx.supabase.storage.from(PAPERS_BUCKET).remove(paths);

  revalidatePapers(input.id);
  return {
    ok: true,
    message: input.status === "deleted" ? "Paper deleted" : input.status === "cancelled" ? "Paper cancelled" : "Paper restarted",
  };
}

/** Record a file the browser just uploaded to the papers bucket (next version for that stage). */
export async function addPaperFileAction(input: PaperFileInput): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = paperFileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;
  if (!v.storage_path.startsWith(`${v.paper_id}/${v.stage}/`) || v.storage_path.includes("..")) {
    return { ok: false, error: "Invalid file." };
  }

  // Next version number for this stage (retry once if two uploads race).
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: last } = await ctx.supabase
      .from("paper_files")
      .select("version")
      .eq("paper_id", v.paper_id)
      .eq("stage", v.stage)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await ctx.supabase.from("paper_files").insert({
      paper_id: v.paper_id,
      stage: v.stage,
      version: (last?.version ?? 0) + 1,
      storage_path: v.storage_path,
      file_name: v.file_name,
      mime_type: v.mime_type,
      size_bytes: v.size_bytes,
      note: v.note || null,
      uploaded_by: ctx.profile.id,
    });
    if (!error) {
      revalidatePapers(v.paper_id);
      return { ok: true, message: `Uploaded as version ${(last?.version ?? 0) + 1}` };
    }
    if (error.code !== "23505") {
      await ctx.supabase.storage.from(PAPERS_BUCKET).remove([v.storage_path]);
      return { ok: false, error: friendlyDbError(error) };
    }
  }
  return { ok: false, error: "Could not save the file. Please try again." };
}

/** The uploader or an admin removes a file version. */
export async function deletePaperFileAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "File not found." };

  const { data: file } = await ctx.supabase
    .from("paper_files")
    .select("id, paper_id, storage_path, uploaded_by")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!file) return { ok: false, error: "File not found." };
  if (file.uploaded_by !== ctx.profile.id && !ctx.profile.is_admin) return { ok: false, error: NOT_ALLOWED };

  const { error } = await ctx.supabase.from("paper_files").delete().eq("id", file.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  // Only admins may delete from the bucket; for others the row is gone and the file is unreachable.
  if (ctx.profile.is_admin) await ctx.supabase.storage.from(PAPERS_BUCKET).remove([file.storage_path]);
  revalidatePapers(file.paper_id);
  return { ok: true, message: "File removed" };
}
