import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TaskStatus } from "@/lib/database.types";
import { formatDate } from "@/lib/format";
import { todayISO } from "@/lib/month";

export type TaskView = {
  id: string;
  title: string;
  description: string | null;
  assigneeId: string;
  assigneeName: string;
  roleId: string | null;
  roleName: string | null;
  examId: string | null;
  examLabel: string | null;
  centreId: string | null;
  centreName: string | null;
  quantity: number | null;
  dueDate: string | null;
  /** "Due tomorrow", "2 days overdue"… */
  dueLabel: string | null;
  overdue: boolean;
  dueSoon: boolean;
  priority: "normal" | "high";
  status: TaskStatus;
  paperId: string | null;
  workCount: number;
  createdByName: string | null;
  completedAt: string | null;
};

const SELECT =
  "id, title, description, assignee_id, role_id, exam_id, centre_id, quantity, due_date, priority, status, completed_at, paper_stage_id, created_by, assignee:profiles!tasks_assignee_id_fkey(full_name, email), creator:profiles!tasks_created_by_fkey(full_name, email), roles(name), exam:exams(name, batch:batches(name)), centre:centres(name), stage:paper_stages(paper_id), submissions(count)";

const DAY = 86_400_000;

export function dueInfo(dueDate: string | null, status: TaskStatus, today = todayISO()) {
  if (!dueDate) return { dueLabel: null, overdue: false, dueSoon: false };
  const days = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
  const active = status === "open";
  if (!active) return { dueLabel: `Due ${formatDate(dueDate)}`, overdue: false, dueSoon: false };
  if (days < 0) return { dueLabel: `${-days} day${days === -1 ? "" : "s"} overdue`, overdue: true, dueSoon: false };
  if (days === 0) return { dueLabel: "Due today", overdue: false, dueSoon: true };
  if (days === 1) return { dueLabel: "Due tomorrow", overdue: false, dueSoon: true };
  return { dueLabel: days <= 14 ? `Due in ${days} days` : `Due ${formatDate(dueDate)}`, overdue: false, dueSoon: days <= 3 };
}

type Row = {
  id: string;
  title: string;
  description: string | null;
  assignee_id: string;
  role_id: string | null;
  exam_id: string | null;
  centre_id: string | null;
  quantity: number | null;
  due_date: string | null;
  priority: "normal" | "high";
  status: TaskStatus;
  completed_at: string | null;
  paper_stage_id: string | null;
  created_by: string | null;
  assignee: { full_name: string; email: string } | null;
  creator: { full_name: string; email: string } | null;
  roles: { name: string } | null;
  exam: { name: string; batch: { name: string } | null } | null;
  centre: { name: string } | null;
  stage: { paper_id: string } | null;
  submissions: { count: number }[];
};

export async function getTasks(
  supabase: SupabaseClient<Database>,
  filters: { assigneeId?: string; statuses?: TaskStatus[]; examId?: string; limit?: number } = {},
  /** Names for people the viewer can't read directly (from the team directory). */
  names?: Map<string, string>,
): Promise<TaskView[]> {
  let query = supabase.from("tasks").select(SELECT);
  if (filters.assigneeId) query = query.eq("assignee_id", filters.assigneeId);
  if (filters.statuses?.length) query = query.in("status", filters.statuses);
  if (filters.examId) query = query.eq("exam_id", filters.examId);
  const { data } = await query
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 300);

  const today = todayISO();
  return ((data ?? []) as unknown as Row[]).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    assigneeId: t.assignee_id,
    assigneeName: t.assignee ? t.assignee.full_name || t.assignee.email : (names?.get(t.assignee_id) ?? "Unknown member"),
    roleId: t.role_id,
    roleName: t.roles?.name ?? null,
    examId: t.exam_id,
    examLabel: t.exam ? `${t.exam.batch?.name ? `${t.exam.batch.name} – ` : ""}${t.exam.name}` : null,
    centreId: t.centre_id,
    centreName: t.centre?.name ?? null,
    quantity: t.quantity,
    dueDate: t.due_date,
    ...dueInfo(t.due_date, t.status, today),
    priority: t.priority,
    status: t.status,
    paperId: t.stage?.paper_id ?? null,
    workCount: t.submissions?.[0]?.count ?? 0,
    createdByName: t.creator ? t.creator.full_name || t.creator.email : ((t.created_by && names?.get(t.created_by)) ?? null),
    completedAt: t.completed_at,
  }));
}
