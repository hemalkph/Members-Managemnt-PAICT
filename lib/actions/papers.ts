"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { pageAccess } from "@/lib/page-access";
import { addDays, PAPERS_BUCKET, PART_LABEL, SCHEME_STAGES } from "@/lib/papers";
import {
  firstError,
  idSchema,
  paperDefaultOwnersSchema,
  groupLinksSchema,
  paperNoteSchema,
  paperSchema,
  paperFileSchema,
  paperStageUpdateSchema,
  stageLinkSchema,
  type PaperFileInput,
  type PaperInput,
} from "@/lib/validation";

function revalidatePapers(id?: string) {
  revalidatePath("/admin/papers");
  revalidatePath("/tasks");
  revalidatePath("/admin/tasks");
  if (id) revalidatePath(`/papers/${id}`);
}

/**
 * Admins: add a paper or tute with its stages (owners, work days, skipped stages).
 * "Split over 2 weeks" adds two papers: MCQ for the exam day and SE & Essay a
 * week later (every date moves 7 days).
 */
export async function createPaperAction(input: PaperInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getActionContext({ page: "papers", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = paperSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const shift = (d: string, days: number) => (d ? addDays(d, days) : null);
  const plan =
    v.part === "split"
      ? [
          { title: `${v.title} – ${PART_LABEL.mcq}`, part: "mcq" as const, exam: v.exam_id, days: 0 },
          { title: `${v.title} – ${PART_LABEL.essay}`, part: "essay" as const, exam: v.exam2_id || v.exam_id, days: 7 },
        ]
      : [{ title: v.title, part: v.part, exam: v.exam_id, days: 0 }];

  const ids: string[] = [];
  for (const p of plan) {
    const { data, error } = await ctx.supabase.rpc("create_paper", {
      p_title: p.title,
      p_kind: v.kind,
      p_exam: p.exam || null,
      p_notes: v.notes || null,
      p_medium: v.medium,
      p_part: p.part,
      p_exam_day: shift(v.exam_day, p.days),
      p_stages: v.stages.map((s) => {
        // Over 2 weeks: the marking scheme is made once, after the SE & Essay
        // paper, so it covers MCQ + Essay.
        const skip = s.skip || (p.part === "mcq" && v.part === "split" && SCHEME_STAGES.includes(s.stage));
        return {
          stage: s.stage,
          owner_id: skip ? null : s.owner_id || null,
          start_date: skip ? null : shift(s.start_date, p.days),
          due_date: skip ? null : shift(s.due_date, p.days),
          skip,
        };
      }),
    });
    if (error || !data) {
      if (ids.length > 0) revalidatePapers();
      return {
        ok: false,
        error: ids.length > 0 ? `The MCQ paper was added, but not the SE & Essay one: ${friendlyDbError(error)}` : friendlyDbError(error),
      };
    }
    ids.push(data);
  }
  ids.forEach((id) => revalidatePapers(id));
  return {
    ok: true,
    message: ids.length > 1 ? "Two papers added (MCQ and SE & Essay) – the first stages have started" : "Paper added – the first stage has started",
    data: { id: ids[0] },
  };
}

/** Admins: change a stage's owner / work days, skip it or mark it done. */
export async function updatePaperStageAction(input: {
  stage_id: string;
  owner_id: string;
  start_date: string;
  due_date: string;
  action: "save" | "skip" | "done";
  paper_id: string;
}): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "papers", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = paperStageUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const { error } = await ctx.supabase.rpc("update_paper_stage", {
    p_stage: v.stage_id,
    p_owner: v.owner_id || null,
    p_start: v.start_date || null,
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

/** The stage owner (or an admin) saves the link to their work, e.g. a Google Drive file. */
export async function setStageLinkAction(input: { stage_id: string; link: string; paper_id: string }): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = stageLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.rpc("set_stage_link", {
    p_stage: parsed.data.stage_id,
    p_link: parsed.data.link || null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePapers(input.paper_id);
  return { ok: true, message: parsed.data.link ? "Link saved" : "Link removed" };
}

/** Admins: cancel, restart or delete a paper. */
export async function setPaperStatusAction(input: {
  id: string;
  status: "cancelled" | "in_progress" | "deleted";
}): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "papers", edit: true });
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
  const editor = pageAccess(ctx.profile, "papers") === "edit";
  if (file.uploaded_by !== ctx.profile.id && !editor) return { ok: false, error: NOT_ALLOWED };

  const { error } = await ctx.supabase.from("paper_files").delete().eq("id", file.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  // Only Papers editors may delete from the bucket; for others the row is gone and the file is unreachable.
  if (editor) await ctx.supabase.storage.from(PAPERS_BUCKET).remove([file.storage_path]);
  revalidatePapers(file.paper_id);
  return { ok: true, message: "File removed" };
}

/** Admins: save the usual owner of each stage; new papers start with them filled in. */
export async function setPaperDefaultOwnersAction(input: { owners: Record<string, string> }): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "papers", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = paperDefaultOwnersSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const owners = Object.fromEntries(Object.entries(parsed.data.owners).filter(([, id]) => id));
  const { error } = await ctx.supabase.rpc("set_paper_default_owners", { p_owners: owners });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/admin/papers");
  return { ok: true, message: "Saved – new papers will start with this team" };
}

/** Anyone working on the paper adds a correction or note (reviews happen here). */
export async function addPaperNoteAction(input: { paper_id: string; stage: string; body: string }): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = paperNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;
  const { error } = await ctx.supabase.from("paper_notes").insert({
    paper_id: v.paper_id,
    stage: v.stage || null,
    author_id: ctx.profile.id,
    body: v.body,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePapers(v.paper_id);
  return { ok: true, message: "Sent – the type setter has been told" };
}

/** The author (or an admin) removes a note. */
export async function deletePaperNoteAction(input: { id: string; paper_id: string }): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse({ id: input.id });
  if (!parsed.success) return { ok: false, error: "Note not found." };
  const { error } = await ctx.supabase.from("paper_notes").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePapers(input.paper_id);
  return { ok: true, message: "Note removed" };
}

/** Admins: the WhatsApp group links used for every paper. */
export async function setGroupLinksAction(input: { lms_group_link: string; physical_group_link: string }): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "papers", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = groupLinksSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { error } = await ctx.supabase.rpc("set_group_links", {
    p_lms: parsed.data.lms_group_link || null,
    p_physical: parsed.data.physical_group_link || null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/admin/papers");
  revalidatePath("/library");
  return { ok: true, message: "Group links saved for every paper" };
}
