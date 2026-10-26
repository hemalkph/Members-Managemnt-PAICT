import type { Metadata } from "next";
import Link from "next/link";
import { CheckCheckIcon, HourglassIcon, ListTodoIcon, TriangleAlertIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import BlurText from "@/components/reactbits/blur-text";
import { StatCard } from "@/components/stat-card";
import { TaskCard } from "@/components/tasks/task-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getTasks } from "@/lib/task-queries";

export const metadata: Metadata = { title: "My tasks" };

export default async function MyTasksPage({ searchParams }: PageProps<"/tasks">) {
  const profile = await requireUser();
  const showDone = (await searchParams).show === "done";
  const supabase = await createClient();
  const tasks = await getTasks(supabase, { assigneeId: profile.id, statuses: ["open", "waiting", "done"] });

  const open = tasks.filter((t) => t.status === "open");
  const waiting = tasks.filter((t) => t.status === "waiting");
  const done = tasks.filter((t) => t.status === "done");
  const overdue = open.filter((t) => t.overdue);
  // Overdue first, then by due date (no date last).
  const sortedOpen = [...open].sort(
    (a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
  );
  const list = showDone ? [...done].reverse() : [...sortedOpen, ...waiting];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <BlurText as="h1" text="My tasks" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
          <p className="text-muted-foreground text-sm">Work the admins gave you. Log your work, then mark it done.</p>
        </div>
        <Tabs value={showDone ? "done" : "todo"}>
          <TabsList>
            <TabsTrigger value="todo" asChild>
              <Link href="/tasks">To do ({open.length + waiting.length})</Link>
            </TabsTrigger>
            <TabsTrigger value="done" asChild>
              <Link href="/tasks?show=done">Done ({done.length})</Link>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="To do" value={open.length} icon={ListTodoIcon} />
        <StatCard label="Overdue" value={overdue.length} icon={TriangleAlertIcon} tone="warning" delay={0.1} />
        <StatCard label="Up next" value={waiting.length} icon={HourglassIcon} tone="info" hint="Paper stages" delay={0.2} />
        <StatCard label="Done" value={done.length} icon={CheckCheckIcon} tone="success" delay={0.3} />
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={ListTodoIcon}
          title={showDone ? "Nothing finished yet" : "No tasks right now"}
          description={showDone ? undefined : "When an admin gives you a task, it appears here and you get a notification."}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => (
            <TaskCard key={t.id} task={t} mode="member" />
          ))}
        </div>
      )}
    </div>
  );
}
