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
  taskFieldFilesSchema,
  taskTypeSchema,
  TASKS_BUCKET,
  type TaskFilesInput,
  type TaskFieldFilesInput,
  type TaskInput,
  type TaskTypeInput,
} from "@/lib/core/validation";
import { checkDetails, readDetails, readFields, type TaskDetail } from "@/lib/tasks/types";

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

  const { data: current } = v.id
    ? await ctx.supabase.from("tasks").select("type_id, details").eq("id", v.id).maybeSingle()
    : { data: null };

  // The type's fields, checked against the type as it is now.
  let details: TaskDetail[] = [];
  if (v.type_id) {
    const { data: type } = await ctx.supabase.from("task_types").select("fields").eq("id", v.type_id).maybeSingle();
    if (!type) return { ok: false, error: "That task type no longer exists." };
    const fields = readFields(type.fields);
    const checked = checkDetails(fields, v.details);
    if ("error" in checked) return { ok: false, error: checked.error };
    // Files already attached to file fields stay (new ones are linked after upload).
    const fileFields = new Set(fields.filter((f) => f.kind === "file").map((f) => f.id));
    const kept =
      current?.type_id === v.type_id ? readDetails(current.details).filter((d) => d.kind === "file" && fileFields.has(d.id)) : [];
    const order = new Map(fields.map((f, i) => [f.id, i]));
    details = [...checked.details, ...kept].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  }

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
    type_id: v.type_id || null,
    details,
  };

  if (v.id) {
    // A task whose type was deleted keeps its filled-in fields when edited.
    const update = !v.type_id && current && current.type_id === null ? { ...row, details: undefined } : row;
    const { error } = await ctx.supabase.from("tasks").update(update).eq("id", v.id);
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
export async function addTaskFilesAction(input: TaskFilesInput): Promise<ActionResult<{ ids: string[] }>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = taskFilesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;
  const paths = v.files.map((f) => f.storage_path);
  if (paths.some((p) => !p.startsWith(`${v.task_id}/${v.kind}/`) || p.includes(".."))) {
    return { ok: false, error: "Invalid file." };
  }

  const { data: saved, error } = await ctx.supabase
    .from("task_files")
    .insert(
      v.files.map((f) => ({
        task_id: v.task_id,
        kind: v.kind,
        storage_path: f.storage_path,
        file_name: f.file_name,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        uploaded_by: ctx.profile.id,
      })),
    )
    .select("id, storage_path");
  if (error) {
    await ctx.supabase.storage.from(TASKS_BUCKET).remove(paths);
    return { ok: false, error: friendlyDbError(error) };
  }
  revalidateTasks();
  // The new files' ids, in the order they were given.
  const idOf = new Map((saved ?? []).map((f) => [f.storage_path, f.id]));
  return {
    ok: true,
    message: v.files.length === 1 ? "File added" : `${v.files.length} files added`,
    data: { ids: paths.map((p) => idOf.get(p) ?? "") },
  };
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

/** Main admins and Tasks page editors: create or edit a task type (preset). */
export async function saveTaskTypeAction(input: TaskTypeInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getActionContext({ page: "tasks", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = taskTypeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const row = {
    name: v.name,
    icon: v.icon || null,
    color: v.color,
    description: v.description || null,
    role_id: v.role_id || null,
    default_assignee_id: v.default_assignee_id || null,
    title_template: v.title_template || null,
    due_days: v.due_days,
    priority: v.priority,
    active: v.active,
    fields: v.fields.map((f) => ({ ...f, options: f.kind === "select" ? f.options : [] })),
  };
  const sameName = (e: { code?: string } | null) => e?.code === "23505";

  if (v.id) {
    const { error } = await ctx.supabase.from("task_types").update(row).eq("id", v.id);
    if (error) return { ok: false, error: sameName(error) ? "A task type with this name exists." : friendlyDbError(error) };
    revalidateTasks();
    return { ok: true, message: "Task type saved", data: { id: v.id } };
  }
  const { data, error } = await ctx.supabase
    .from("task_types")
    .insert({ ...row, created_by: ctx.profile.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: sameName(error) ? "A task type with this name exists." : friendlyDbError(error) };
  revalidateTasks();
  return { ok: true, message: "Task type added", data: { id: data.id } };
}

/** Delete a task type. Tasks already given keep their filled-in fields. */
export async function deleteTaskTypeAction(input: { id: string }): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "tasks", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid task type." };
  const { error } = await ctx.supabase.from("task_types").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateTasks();
  return { ok: true, message: "Task type deleted" };
}

/**
 * Links files uploaded for a task's "File upload" fields (Tasks editors). Each
 * file must belong to the task, and each field must be a file field of its type.
 */
export async function setTaskFieldFilesAction(input: TaskFieldFilesInput): Promise<ActionResult> {
  const ctx = await getActionContext({ page: "tasks", edit: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = taskFieldFilesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const { data: task } = await ctx.supabase
    .from("tasks")
    .select("type_id, details, task_types(fields)")
    .eq("id", v.task_id)
    .maybeSingle();
  if (!task?.task_types) return { ok: false, error: "Task not found." };
  const fileFields = new Map(readFields(task.task_types.fields).filter((f) => f.kind === "file").map((f) => [f.id, f]));

  const { data: files } = await ctx.supabase
    .from("task_files")
    .select("id")
    .eq("task_id", v.task_id)
    .in(
      "id",
      v.files.map((f) => f.file_id),
    );
  const ours = new Set((files ?? []).map((f) => f.id));
  if (v.files.some((f) => !fileFields.has(f.field_id) || !ours.has(f.file_id))) return { ok: false, error: "Invalid file." };

  const order = new Map(readFields(task.task_types.fields).map((f, i) => [f.id, i]));
  const linked = new Map(v.files.map((f) => [f.field_id, f.file_id]));
  const details: TaskDetail[] = [
    ...readDetails(task.details).filter((d) => !linked.has(d.id)),
    ...v.files.map((f) => ({ id: f.field_id, label: fileFields.get(f.field_id)!.label, kind: "file" as const, value: f.file_id })),
  ].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

  const { error } = await ctx.supabase.from("tasks").update({ details }).eq("id", v.task_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateTasks();
  return { ok: true, message: "Files attached" };
}
