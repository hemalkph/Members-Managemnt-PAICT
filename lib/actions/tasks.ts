"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { firstError, idSchema, taskSchema, taskStatusSchema, type TaskInput } from "@/lib/validation";

function revalidateTasks() {
  revalidatePath("/tasks");
  revalidatePath("/admin/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/admin/papers");
}

/** Admins: create or edit a task. */
export async function saveTaskAction(input: TaskInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getActionContext({ admin: true });
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
  if (parsed.data.status === "cancelled" && !ctx.profile.is_admin) return { ok: false, error: NOT_ALLOWED };

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
  const ctx = await getActionContext({ admin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Task not found." };

  const { data: task } = await ctx.supabase.from("tasks").select("paper_stage_id").eq("id", parsed.data.id).maybeSingle();
  if (!task) return { ok: false, error: "Task not found." };
  if (task.paper_stage_id) return { ok: false, error: "This task belongs to a paper. Change it on the paper page." };

  const { error } = await ctx.supabase.from("tasks").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidateTasks();
  return { ok: true, message: "Task deleted" };
}
