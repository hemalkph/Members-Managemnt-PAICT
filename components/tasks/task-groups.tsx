"use client";

import { useState, type ReactNode } from "react";
import { ChevronDownIcon, FileStackIcon, ListTodoIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { TaskView } from "@/lib/tasks/queries";
import { cn } from "@/lib/utils";

/** Tasks first, then paper stages, each in a clean collapsible full-width list section. */
export function TaskGroups({ tasks, render }: { tasks: TaskView[]; render: (task: TaskView) => ReactNode }) {
  const groups = [
    {
      key: "tasks",
      title: "Tasks",
      icon: ListTodoIcon,
      tone: "bg-primary/10 text-primary border-primary/20",
      items: tasks.filter((t) => !t.paperId),
    },
    {
      key: "papers",
      title: "Paper stages",
      icon: FileStackIcon,
      tone: "bg-chart-2/12 text-chart-2 border-chart-2/25",
      items: tasks.filter((t) => t.paperId),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <TaskGroupSection
          key={g.key}
          title={g.title}
          icon={g.icon}
          tone={g.tone}
          items={g.items}
          showHeader={groups.length > 1}
          render={render}
        />
      ))}
    </div>
  );
}

function TaskGroupSection({
  title,
  icon: Icon,
  tone,
  items,
  showHeader,
  render,
}: {
  title: string;
  icon: typeof ListTodoIcon;
  tone: string;
  items: TaskView[];
  showHeader: boolean;
  render: (task: TaskView) => ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const overdueCount = items.filter((t) => t.status === "open" && t.overdue).length;

  if (!showHeader) {
    return (
      <section aria-label={title} className="space-y-2">
        {items.map(render)}
      </section>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section aria-label={title} className="space-y-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="hover:bg-muted/60 group flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 text-left transition-colors"
          >
            <span className="flex items-center gap-2 text-xs font-semibold sm:text-sm">
              <span className={cn("flex size-5.5 items-center justify-center rounded-md border", tone)}>
                <Icon className="size-3.5" />
              </span>
              <span>{title}</span>
              <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px] tabular-nums">
                {items.length}
              </Badge>
              {overdueCount > 0 && (
                <Badge variant="destructive" className="h-5 gap-1 rounded-full px-2 text-[11px] tabular-nums">
                  <TriangleAlertIcon className="size-3" /> {overdueCount} overdue
                </Badge>
              )}
            </span>
            <ChevronDownIcon
              className={cn(
                "text-muted-foreground size-4 transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2">{items.map(render)}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}
