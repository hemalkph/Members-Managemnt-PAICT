"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { monthKeyToDate } from "@/lib/month";
import { isProfileComplete } from "@/lib/profile-completion";
import { ATTACHMENTS_BUCKET } from "@/lib/storage";
import { fieldErrorsOf, firstError, idSchema, submissionActionSchema, type AttachmentInput } from "@/lib/validation";
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
