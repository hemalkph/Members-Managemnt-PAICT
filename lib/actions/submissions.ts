"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { getDeadlines } from "@/lib/deadlines";
import { APP_TIME_ZONE, currentMonthKey, monthKeyToDate, todayISO } from "@/lib/month";
import { getMarkingRates, MARKING_LABEL, setKey, setParts, setTitle } from "@/lib/marking";
import { getPaperDrafts } from "@/lib/paper-drafts";
import { getClosedMonthKeys } from "@/lib/payments";
import { isProfileComplete } from "@/lib/profile-completion";
import { ATTACHMENTS_BUCKET } from "@/lib/storage";
import {
  fieldErrorsOf,
  firstError,
  idSchema,
  markingLogSchema,
  paperPagesSchema,
  submissionActionSchema,
  type AttachmentInput,
} from "@/lib/validation";
import type { z } from "zod";

type SubmissionActionInput = z.input<typeof submissionActionSchema>;
type Ctx = NonNullable<Awaited<ReturnType<typeof getActionContext>>>;

function revalidateWork() {
  revalidatePath("/work");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/admin", "layout");
}

/** Files must have been uploaded into the member's own folder. */
function ownAttachments(ctx: Ctx, attachments: AttachmentInput[]) {
  return attachments.every((a) => a.storage_path.startsWith(`${ctx.profile.id}/`) && !a.storage_path.includes(".."));
}

async function hasRole(ctx: Ctx, roleId: string) {
  const { data } = await ctx.supabase
    .from("member_roles")
    .select("role_id")
    .eq("user_id", ctx.profile.id)
    .eq("role_id", roleId)
    .maybeSingle();
  return Boolean(data);
}

/** The role's work types: one must be chosen when the role has any. */
async function checkWorkType(ctx: Ctx, roleId: string, rateItemId: string): Promise<string | null> {
  const { data } = await ctx.supabase.from("rate_items").select("id").eq("role_id", roleId);
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length === 0) return null;
  if (!rateItemId) return "Choose the type of work.";
  return ids.includes(rateItemId) ? null : "That work type doesn't belong to the chosen role.";
}

async function insertAttachments(ctx: Ctx, submissionId: string, attachments: AttachmentInput[]) {
  if (attachments.length === 0) return null;
  const { error } = await ctx.supabase.from("submission_attachments").insert(
    attachments.map((a) => ({
      submission_id: submissionId,
      user_id: ctx.profile.id,
      storage_path: a.storage_path,
      file_name: a.file_name,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
    })),
  );
  return error;
}

export async function createSubmissionAction(input: SubmissionActionInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = submissionActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };
  const v = parsed.data;

  if (!ctx.profile.is_admin && !isProfileComplete(ctx.profile)) {
    return { ok: false, error: "Please complete your profile before submitting work." };
  }
  if (!(await hasRole(ctx, v.role_id))) return { ok: false, error: "You can only log work for your own roles." };
  if (!ownAttachments(ctx, v.attachments)) return { ok: false, error: "Invalid attachment." };
  const typeError = await checkWorkType(ctx, v.role_id, v.rate_item_id);
  if (typeError) return { ok: false, error: typeError, fieldErrors: { rate_item_id: [typeError] } };

  const { data: created, error } = await ctx.supabase
    .from("submissions")
    .insert({
      user_id: ctx.profile.id,
      role_id: v.role_id,
      rate_item_id: v.rate_item_id || null,
      work_month: monthKeyToDate(v.work_month),
      title: v.title,
      description: v.description || null,
      quantity: v.quantity,
      date_done: v.date_done,
      links: v.links.map((l) => l.url),
      exam_id: v.exam_id || null,
      centre_id: v.centre_id || null,
      task_id: v.task_id || null,
    })
    .select("id")
    .single();

  if (error || !created) return { ok: false, error: friendlyDbError(error) };

  const attachError = await insertAttachments(ctx, created.id, v.attachments);
  if (attachError) {
    // Keep things consistent: undo the submission if its files could not be saved.
    await ctx.supabase.from("submissions").delete().eq("id", created.id);
    return { ok: false, error: "Could not save the attachments. Please try again." };
  }

  revalidateWork();
  return { ok: true, message: "Work submitted for review", data: { id: created.id } };
}

export async function updateSubmissionAction(
  id: string,
  input: SubmissionActionInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const idParsed = idSchema.safeParse({ id });
  const parsed = submissionActionSchema.safeParse(input);
  if (!idParsed.success) return { ok: false, error: "Invalid submission." };
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };
  const v = parsed.data;

  const { data: existing } = await ctx.supabase
    .from("submissions")
    .select("id, status, user_id, submission_attachments(id, storage_path)")
    .eq("id", id)
    .eq("user_id", ctx.profile.id)
    .maybeSingle();

  if (!existing) return { ok: false, error: "Submission not found." };
  if (existing.status !== "pending") return { ok: false, error: "Only pending submissions can be edited." };
  if (!(await hasRole(ctx, v.role_id))) return { ok: false, error: "You can only log work for your own roles." };
  if (!ownAttachments(ctx, v.attachments)) return { ok: false, error: "Invalid attachment." };
  const typeError = await checkWorkType(ctx, v.role_id, v.rate_item_id);
  if (typeError) return { ok: false, error: typeError, fieldErrors: { rate_item_id: [typeError] } };

  const kept = existing.submission_attachments.filter((a) => !v.removed_attachment_ids.includes(a.id)).length;
  if (kept + v.attachments.length > 10) return { ok: false, error: "Up to 10 files per submission." };

  const { error } = await ctx.supabase
    .from("submissions")
    .update({
      role_id: v.role_id,
      rate_item_id: v.rate_item_id || null,
      work_month: monthKeyToDate(v.work_month),
      title: v.title,
      description: v.description || null,
      quantity: v.quantity,
      date_done: v.date_done,
      links: v.links.map((l) => l.url),
      exam_id: v.exam_id || null,
      centre_id: v.centre_id || null,
      task_id: v.task_id || null,
    })
    .eq("id", id)
    .eq("status", "pending");
  if (error) return { ok: false, error: friendlyDbError(error) };

  // Remove files the member deleted in the form.
  const toRemove = existing.submission_attachments.filter((a) => v.removed_attachment_ids.includes(a.id));
  if (toRemove.length > 0) {
    await ctx.supabase
      .from("submission_attachments")
      .delete()
      .in(
        "id",
        toRemove.map((a) => a.id),
      );
    await ctx.supabase.storage.from(ATTACHMENTS_BUCKET).remove(toRemove.map((a) => a.storage_path));
  }

  const attachError = await insertAttachments(ctx, id, v.attachments);
  if (attachError) return { ok: false, error: "Saved, but some new files could not be attached." };

  revalidateWork();
  return { ok: true, message: "Submission updated", data: { id } };
}

export async function deleteSubmissionAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid submission." };

  const { data: existing } = await ctx.supabase
    .from("submissions")
    .select("id, status, submission_attachments(storage_path)")
    .eq("id", parsed.data.id)
    .eq("user_id", ctx.profile.id)
    .maybeSingle();

  if (!existing) return { ok: false, error: "Submission not found." };
  if (existing.status !== "pending") return { ok: false, error: "Only pending submissions can be deleted." };

  const { error } = await ctx.supabase.from("submissions").delete().eq("id", existing.id).eq("status", "pending");
  if (error) return { ok: false, error: friendlyDbError(error) };

  const paths = existing.submission_attachments.map((a) => a.storage_path);
  if (paths.length > 0) await ctx.supabase.storage.from(ATTACHMENTS_BUCKET).remove(paths);

  revalidateWork();
  return { ok: true, message: "Submission deleted" };
}

/**
 * A finished type setting / conversion stage becomes a work entry: the member
 * only enters the number of pages. Role, work type, title, exam and date come
 * from the paper.
 */
export async function logPaperPagesAction(input: { task_id: string; pages: number }): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = paperPagesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  if (!ctx.profile.is_admin && !isProfileComplete(ctx.profile)) {
    return { ok: false, error: "Please complete your profile before submitting work." };
  }

  const [draft] = await getPaperDrafts(ctx.supabase, ctx.profile.id, parsed.data.task_id);
  if (!draft) return { ok: false, error: "This work is already logged." };
  if (!draft.rate) return { ok: false, error: "Choose your role and work type in the full form." };

  // Logged in the month it was finished, or this month if that one is closed.
  const doneOn = draft.completedAt
    ? new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }).format(new Date(draft.completedAt))
    : todayISO();
  let month = doneOn.slice(0, 7);
  let dateDone = doneOn;
  const [closed, deadlines] = await Promise.all([
    getClosedMonthKeys(ctx.supabase),
    ctx.profile.is_admin ? Promise.resolve(new Map()) : getDeadlines(ctx.supabase, [month]),
  ]);
  if (closed.includes(month) || deadlines.get(month)?.passed) {
    month = currentMonthKey();
    dateDone = todayISO();
  }

  const pages = parsed.data.pages;
  const { error } = await ctx.supabase.from("submissions").insert({
    user_id: ctx.profile.id,
    role_id: draft.rate.roleId,
    rate_item_id: draft.rate.rateItemId,
    work_month: monthKeyToDate(month),
    title: draft.title.slice(0, 150),
    description: `${draft.stageLabel} – ${pages} page${pages === 1 ? "" : "s"}`,
    quantity: pages,
    date_done: dateDone,
    links: draft.link ? [draft.link] : [],
    exam_id: draft.examId,
    task_id: draft.taskId,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidateWork();
  return { ok: true, message: `${pages} page${pages === 1 ? "" : "s"} sent for review` };
}

/**
 * Marking team: log how many papers were marked at each centre. One work
 * entry per centre and part (MCQ / Essay), paid at the marking rates.
 */
export async function logMarkingAction(input: {
  /** One paper, or the papers of one set (e.g. "RFP 04 - MCQ" and "RFP 04 - SE & Essay"). */
  paper_ids: string[];
  rows: { centre_id: string; mcq: number; essay: number; full?: number }[];
}): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = markingLogSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  if (!ctx.profile.is_admin && !isProfileComplete(ctx.profile)) {
    return { ok: false, error: "Please complete your profile before submitting work." };
  }
  const v = parsed.data;

  const [{ data: papers }, { data: centres }, rates] = await Promise.all([
    ctx.supabase.from("papers").select("id, title, kind, part, exam_id, status").in("id", v.paper_ids),
    ctx.supabase
      .from("centres")
      .select("id, name")
      .in(
        "id",
        v.rows.map((r) => r.centre_id),
      ),
    getMarkingRates(ctx.supabase, ctx.profile.id),
  ]);
  const set = (papers ?? []).filter((p) => p.kind === "paper" && p.status !== "cancelled");
  if (set.length === 0 || set.length !== new Set(v.paper_ids).size) return { ok: false, error: "Paper not found." };
  const title = setTitle(set[0].title);
  if (set.some((p) => setKey(p.title) !== setKey(title)))
    return { ok: false, error: "Choose one paper set at a time." };
  const parts = setParts(set);
  const examId = set.find((p) => p.exam_id)?.exam_id ?? null;
  const centreName = new Map((centres ?? []).map((c) => [c.id, c.name]));

  const month = currentMonthKey();
  const [closed, deadlines] = await Promise.all([
    getClosedMonthKeys(ctx.supabase),
    ctx.profile.is_admin ? Promise.resolve(new Map()) : getDeadlines(ctx.supabase, [month]),
  ]);
  if (closed.includes(month) || deadlines.get(month)?.passed) {
    return { ok: false, error: "This month is closed for new work. Ask an admin." };
  }

  const LABEL = MARKING_LABEL;
  const rows = [];
  for (const r of v.rows) {
    const centre = centreName.get(r.centre_id);
    if (!centre) return { ok: false, error: "Choose a centre from the list." };
    if (r.full > 0 && (r.mcq > 0 || r.essay > 0)) {
      return { ok: false, error: `${centre}: enter full papers, or MCQ and Essay – not both.` };
    }
    for (const part of parts) {
      const count = r[part];
      if (count <= 0) continue;
      const rate = rates[part];
      if (!rate) {
        return { ok: false, error: `You don't have a "${LABEL[part]} marking" rate yet. Ask an admin.` };
      }
      rows.push({
        user_id: ctx.profile.id,
        role_id: rate.roleId,
        rate_item_id: rate.rateItemId,
        work_month: monthKeyToDate(month),
        title: `${title} – ${LABEL[part]} marking – ${centre}`.slice(0, 150),
        description: `${count} ${part === "full" ? "full" : LABEL[part]} paper${count === 1 ? "" : "s"} marked · ${centre}`,
        quantity: count,
        date_done: todayISO(),
        links: [],
        exam_id: examId,
        centre_id: r.centre_id,
      });
    }
  }
  if (rows.length === 0) return { ok: false, error: "Enter how many papers you marked." };

  const { error } = await ctx.supabase.from("submissions").insert(rows);
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidateWork();
  revalidatePath("/work/marking");
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  return { ok: true, message: `${total} marked paper${total === 1 ? "" : "s"} sent for review` };
}
