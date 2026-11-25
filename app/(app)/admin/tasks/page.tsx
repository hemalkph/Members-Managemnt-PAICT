import { addDaysISO } from "@/lib/team/availability";
import { getTeamDaysOff } from "@/lib/team/days-off-queries";
import type { Metadata } from "next";
import { waNumber } from "@/components/papers/review-contacts";
import { AdminTaskBoard } from "@/components/tasks/admin-task-board";
import { requirePage } from "@/lib/auth";
import { todayISO } from "@/lib/core/month";
import { uuid } from "@/lib/core/validation";
import { getTeamDirectory, teamNames } from "@/lib/members/team-directory";
import { activeOptions, getClassOptions } from "@/lib/organisation/classes";
import type { TaskStatus } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { getTasks, getTaskTypes } from "@/lib/tasks/queries";

export const metadata: Metadata = { title: "Tasks" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const VIEWS: Record<"open" | "done" | "cancelled", { statuses: TaskStatus[] }> = {
  open: { statuses: ["open", "waiting"] },
  done: { statuses: ["done"] },
  cancelled: { statuses: ["cancelled"] },
};

type ViewKey = keyof typeof VIEWS;

export default async function AdminTasksPage({ searchParams }: PageProps<"/admin/tasks">) {
  const { canEdit } = await requirePage("tasks");
  const sp = await searchParams;
  const rawView = one(sp.view);
  const view: ViewKey = rawView === "done" || rawView === "cancelled" ? rawView : "open";
  const member = uuid.safeParse(one(sp.member)).success ? one(sp.member) : "";
  const role = uuid.safeParse(one(sp.role)).success ? one(sp.role) : "";
  const exam = uuid.safeParse(one(sp.exam)).success ? one(sp.exam) : "";
  const type = uuid.safeParse(one(sp.type)).success ? one(sp.type) : "";
  const today = todayISO();

  const supabase = await createClient();
  const team = await getTeamDirectory(supabase);
  const names = teamNames(team);

  const countStatus = (statuses: TaskStatus[]) => {
    let q = supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", statuses);
    if (member) q = q.eq("assignee_id", member);
    if (role) q = q.eq("role_id", role);
    if (exam) q = q.eq("exam_id", exam);
    if (type) q = q.eq("type_id", type);
    return q;
  };

  const thirtyDaysAgo = `${new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`;

  const [
    tasks,
    openTasks,
    classOptions,
    { data: roles },
    { data: memberRoles },
    types,
    { count: openTabCount },
    { count: doneTabCount },
    { count: cancelledTabCount },
    { count: done30Count },
  ] = await Promise.all([
    getTasks(
      supabase,
      {
        statuses: VIEWS[view].statuses,
        assigneeId: member || undefined,
        roleId: role || undefined,
        examId: exam || undefined,
        typeId: type || undefined,
        orderBy: view === "done" ? "completed" : "due",
      },
      names,
    ),
    getTasks(supabase, { statuses: ["open"], limit: 1000 }, names),
    getClassOptions(supabase),
    supabase.from("roles").select("id, name").order("sort_order").order("name"),
    supabase.from("member_roles").select("user_id, role_id"),
    getTaskTypes(supabase),
    countStatus(["open", "waiting"]),
    countStatus(["done"]),
    countStatus(["cancelled"]),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "done")
      .gte("completed_at", thirtyDaysAgo),
  ]);

  const tags = activeOptions(classOptions);
  const daysOff = await getTeamDaysOff(supabase, today, addDaysISO(today, 60));
  const weekAhead = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const overdue = openTasks.filter((t) => t.overdue).length;
  const dueThisWeek = openTasks.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= weekAhead).length;

  const activeMembers = team.filter((p) => p.isActive);
  const options = {
    members: activeMembers.map((p) => ({
      id: p.id,
      name: p.name,
      open: openTasks.filter((t) => t.assigneeId === p.id).length,
      roleIds: (memberRoles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role_id),
    })),
    roles: roles ?? [],
    exams: tags.exams.map((e) => ({ id: e.id, label: e.label })),
    centres: tags.centres.map((c) => ({ id: c.id, name: c.name })),
    types,
    daysOff,
  };

  return (
    <AdminTaskBoard
      view={view}
      tasks={tasks}
      counts={{
        open: openTabCount ?? 0,
        done: doneTabCount ?? 0,
        cancelled: cancelledTabCount ?? 0,
      }}
      kpis={{
        open: openTasks.length,
        overdue,
        dueThisWeek,
        done30Days: done30Count ?? 0,
      }}
      filters={{ member, role, exam, type }}
      options={options}
      allMembers={team.map((p) => ({ id: p.id, name: p.name }))}
      allExams={classOptions.exams.map((e) => ({ id: e.id, label: e.label }))}
      today={today}
      readOnly={!canEdit}
      phones={Object.fromEntries(
        team.flatMap((p) => {
          const n = waNumber(p.whatsapp || p.phone);
          return n ? [[p.id, n]] : [];
        }),
      )}
    />
  );
}
