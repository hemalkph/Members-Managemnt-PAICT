import type { Metadata } from "next";
import { MemberTaskBoard } from "@/components/tasks/member-task-board";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getTasks } from "@/lib/tasks/queries";

export const metadata: Metadata = { title: "My tasks" };

export default async function MyTasksPage({ searchParams }: PageProps<"/tasks">) {
  const profile = await requireUser();
  const showDone = (await searchParams).show === "done";
  const supabase = await createClient();
  const tasks = await getTasks(supabase, { assigneeId: profile.id, statuses: ["open", "waiting", "done"] });

  const open = tasks.filter((t) => t.status === "open");
  const waiting = tasks.filter((t) => t.status === "waiting");
  const done = tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completedAt ?? b.dueDate ?? "").localeCompare(a.completedAt ?? a.dueDate ?? ""));

  // Overdue first, then sent-back, then high priority, then soonest due date.
  const sortedOpen = [...open].sort((a, b) => {
    const rank = (t: (typeof open)[number]) => (t.overdue ? 0 : t.fixNote ? 1 : t.priority === "high" ? 2 : 3);
    return rank(a) - rank(b) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  });

  return (
    <MemberTaskBoard
      showDone={showDone}
      openTasks={sortedOpen}
      waitingTasks={waiting}
      doneTasks={done}
    />
  );
}
