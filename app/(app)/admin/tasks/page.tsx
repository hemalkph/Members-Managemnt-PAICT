import type { Metadata } from "next";
import { AlarmClockIcon, CheckCheckIcon, ListTodoIcon, TriangleAlertIcon } from "lucide-react";
import BlurText from "@/components/reactbits/blur-text";
import { StatCard } from "@/components/stat-card";
import { waNumber } from "@/components/papers/review-contacts";
import { AdminTaskBoard } from "@/components/tasks/admin-task-board";
import { TaskFilters } from "@/components/tasks/task-filters";
import { requireAdmin } from "@/lib/auth";
import { activeOptions, getClassOptions } from "@/lib/classes";
import type { TaskStatus } from "@/lib/database.types";
import { todayISO } from "@/lib/month";
import { createClient } from "@/lib/supabase/server";
import { getTasks } from "@/lib/task-queries";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Tasks" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const VIEWS: Record<string, { statuses: TaskStatus[]; empty: string }> = {
  open: { statuses: ["open", "waiting"], empty: "No open tasks" },
  done: { statuses: ["done"], empty: "Nothing finished yet" },
  cancelled: { statuses: ["cancelled"], empty: "No cancelled tasks" },
};

export default async function AdminTasksPage({ searchParams }: PageProps<"/admin/tasks">) {
  await requireAdmin();
  const sp = await searchParams;
  const view = VIEWS[one(sp.view)] ? one(sp.view) : "open";
  const member = uuid.safeParse(one(sp.member)).success ? one(sp.member) : "";
  const exam = uuid.safeParse(one(sp.exam)).success ? one(sp.exam) : "";
  const today = todayISO();

  const supabase = await createClient();
  const [tasks, openTasks, classOptions, { data: profiles }, { data: roles }, { data: memberRoles }] =
    await Promise.all([
      getTasks(supabase, {
        statuses: VIEWS[view].statuses,
        assigneeId: member || undefined,
        examId: exam || undefined,
      }),
      getTasks(supabase, { statuses: ["open"], limit: 1000 }),
      getClassOptions(supabase),
      supabase.from("profiles").select("id, full_name, email, is_active, whatsapp, phone").order("full_name"),
      supabase.from("roles").select("id, name").order("sort_order").order("name"),
      supabase.from("member_roles").select("user_id, role_id"),
    ]);

  const tags = activeOptions(classOptions);
  const weekAhead = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const overdue = openTasks.filter((t) => t.overdue).length;
  const dueThisWeek = openTasks.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= weekAhead).length;
  const { count: doneCount } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("status", "done")
    .gte(
      "completed_at",
      `${new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`,
    );

  const activeMembers = (profiles ?? []).filter((p) => p.is_active);
  const options = {
    members: activeMembers.map((p) => ({
      id: p.id,
      name: p.full_name || p.email,
      roleIds: (memberRoles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role_id),
    })),
    roles: roles ?? [],
    exams: tags.exams.map((e) => ({ id: e.id, label: e.label })),
    centres: tags.centres.map((c) => ({ id: c.id, name: c.name })),
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <BlurText as="h1" text="Tasks" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
        <p className="text-muted-foreground text-sm">Give members work with a due date and see what is overdue.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open tasks" value={openTasks.length} icon={ListTodoIcon} />
        <StatCard label="Overdue" value={overdue} icon={TriangleAlertIcon} tone="warning" delay={0.1} />
        <StatCard label="Due in 7 days" value={dueThisWeek} icon={AlarmClockIcon} tone="info" delay={0.2} />
        <StatCard label="Done (30 days)" value={doneCount ?? 0} icon={CheckCheckIcon} tone="success" delay={0.3} />
      </div>

      <TaskFilters
        view={view}
        member={member}
        exam={exam}
        members={(profiles ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email }))}
        exams={classOptions.exams.map((e) => ({ id: e.id, label: e.label }))}
      />

      <AdminTaskBoard
        tasks={tasks}
        options={options}
        today={today}
        emptyTitle={VIEWS[view].empty}
        phones={Object.fromEntries(
          (profiles ?? []).flatMap((p) => {
            const n = waNumber(p.whatsapp || p.phone);
            return n ? [[p.id, n]] : [];
          }),
        )}
      />
    </div>
  );
}
