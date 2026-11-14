import type { ReactNode } from "react";
import { FileStackIcon, ListTodoIcon } from "lucide-react";
import type { TaskView } from "@/lib/tasks/queries";

/** Tasks first, then paper stages, each under its own heading so they don't mix. */
export function TaskGroups({ tasks, render }: { tasks: TaskView[]; render: (task: TaskView) => ReactNode }) {
  const groups = [
    { key: "tasks", title: "Tasks", icon: ListTodoIcon, tone: "bg-primary/10 text-primary", items: tasks.filter((t) => !t.paperId) },
    {
      key: "papers",
      title: "Paper stages",
      icon: FileStackIcon,
      tone: "bg-chart-2/15 text-chart-2",
      items: tasks.filter((t) => t.paperId),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.key} className="space-y-3" aria-label={g.title}>
          {groups.length > 1 && (
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <span className={`flex size-6 items-center justify-center rounded-md ${g.tone}`}>
                <g.icon className="size-3.5" />
              </span>
              {g.title}
              <span className="text-muted-foreground font-normal tabular-nums">{g.items.length}</span>
            </h2>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{g.items.map(render)}</div>
        </section>
      ))}
    </div>
  );
}
