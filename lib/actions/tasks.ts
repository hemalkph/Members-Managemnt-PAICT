"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { pageAccess } from "@/lib/auth/page-access";
import {
  firstError,
  idSchema,
  taskFilesSchema,
  taskSchema,
  taskStatusSchema,
  TASKS_BUCKET,
  type TaskFilesInput,
  type TaskInput,
} from "@/lib/core/validation";

function revalidateTasks() {
  revalidatePath("/tasks");
  revalidatePath("/admin/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/admin/papers");
}

/** Admins: create or edit a task. */
export async function saveTaskAction(input: TaskInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getActionContext({ page: "tasks", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const { data: assignee } = await ctx.supabase
    .from("profiles")
    .select("id, is_active")
    .eq("id", v.assignee_id)
    .maybeSingle();
  if (!assignee?.is_active) return { ok: false, error: "Choose an active member." };

  const row = {
    title: v.title,
    description: v.description || null,
    assignee_id: v.assignee_id,
    role_id: v.role_id || null,
    exam_id: v.exam_id || null,
    centre_id: v.centre_id || null,
    quantity: v.quantity ?? null,
    due_date: v.due_date || null,
    priority: v.priority,
  };

  if (v.id) {
    const { error } = await ctx.supabase.from("tasks").update(row).eq("id", v.id);
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidateTasks();
    return { ok: true, message: "Task saved", data: { id: v.id } };
  }

  const { data, error } = await ctx.supabase
    .from("tasks")
    .insert({ ...row, created_by: ctx.profile.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: friendlyDbError(error) };
  revalidateTasks();
  return { ok: true, message: "Task assigned", data: { id: data.id } };
}

/** Members mark their own task done (or undo); admins can also cancel or reopen. */
export async function setTaskStatusAction(input: { id: string; status: "open" | "done" | "cancelled" }): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = taskStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  if (parsed.data.status === "cancelled" && pageAccess(ctx.profile, "tasks") !== "edit") return { ok: false, error: NOT_ALLOWED };

  const { data, error } = await ctx.supabase
    .from("tasks")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data || data.length === 0) return { ok: false, error: "Task not found." };

  revalidateTasks();
  revalidatePath("/papers", "layout");
  const message =
    parsed.data.status === "done" ? "Task done – nice work!" : parsed.data.status === "cancelled" ? "Task cancelled" : "Task reopened";
  return { ok: true, message };
}

/** Admins: delete a task (paper stage tasks are managed on the paper page). */
export async function deleteTaskAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "tasks", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Task not found." };

  const { data: task } = await ctx.supabase.from("tasks").select("paper_stage_id").eq("id", parsed.data.id).maybeSingle();
  if (!task) return { ok: false, error: "Task not found." };
  if (task.paper_stage_id) return { ok: false, error: "This task belongs to a paper. Change it on the paper page." };

  const { data: files } = await ctx.supabase.from("task_files").select("storage_path").eq("task_id", parsed.data.id);
  const { error } = await ctx.supabase.from("tasks").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (files?.length) await ctx.supabase.storage.from(TASKS_BUCKET).remove(files.map((f) => f.storage_path));
  revalidateTasks();
  return { ok: true, message: "Task deleted" };
}

/**
 * Save files already uploaded to storage: the brief (Tasks editors) or the
 * member's work (the assignee). The database policies decide who may add what.
 */
export async function addTaskFilesAction(input: TaskFilesInput): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = taskFilesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;
  const paths = v.files.map((f) => f.storage_path);
  if (paths.some((p) => !p.startsWith(`${v.task_id}/${v.kind}/`) || p.includes(".."))) {
    return { ok: false, error: "Invalid file." };
  }

  const { error } = await ctx.supabase.from("task_files").insert(
    v.files.map((f) => ({
      task_id: v.task_id,
      kind: v.kind,
      storage_path: f.storage_path,
      file_name: f.file_name,
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
      uploaded_by: ctx.profile.id,
    })),
  );
  if (error) {
    await ctx.supabase.storage.from(TASKS_BUCKET).remove(paths);
    return { ok: false, error: friendlyDbError(error) };
  }
  revalidateTasks();
  return { ok: true, message: v.files.length === 1 ? "File added" : `${v.files.length} files added` };
}

/** Remove a task file: your own upload, or any file with Tasks edit access. */
export async function deleteTaskFileAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "File not found." };

  const { data, error } = await ctx.supabase.from("task_files").delete().eq("id", parsed.data.id).select("storage_path");
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false, error: "You can't remove this file." };
  await ctx.supabase.storage.from(TASKS_BUCKET).remove([data[0].storage_path]);
  revalidateTasks();
  return { ok: true, message: "File removed" };
}
