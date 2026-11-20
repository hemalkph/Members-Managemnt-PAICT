"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CheckCheckIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  FileStackIcon,
  HourglassIcon,
  ListTodoIcon,
  RotateCcwIcon,
  SearchIcon,
  SearchXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import BlurText from "@/components/reactbits/blur-text";
import { Sticker } from "@/components/sticker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { TaskView } from "@/lib/tasks/queries";
import { TaskGroups } from "./task-groups";
import { TaskKpiStrip, type TaskKpiItem } from "./task-kpi-strip";
import { TaskRow } from "./task-row";

/** Member "My tasks" view using the same scannable expandable row UI and KPI strip. */
export function MemberTaskBoard({
  showDone,
  openTasks,
  waitingTasks,
  doneTasks,
}: {
  showDone: boolean;
  openTasks: TaskView[];
  waitingTasks: TaskView[];
  doneTasks: TaskView[];
}) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"all" | "tasks" | "papers">("all");
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  const overdueCount = useMemo(() => openTasks.filter((t) => t.overdue).length, [openTasks]);

  const baseList = useMemo(
    () => (showDone ? [...doneTasks] : [...openTasks, ...waitingTasks]),
    [showDone, openTasks, waitingTasks, doneTasks],
  );

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return baseList.filter((t) => {
      if (source === "tasks" && t.paperId) return false;
      if (source === "papers" && !t.paperId) return false;
      if (!showDone && onlyOverdue && !(t.status === "open" && t.overdue)) return false;
      if (q) {
        const hay = [t.title, t.description, t.roleName, t.examLabel, t.centreName, t.typeName, t.fixNote]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [baseList, search, source, onlyOverdue, showDone]);

  const hasFilters = Boolean(search.trim() || source !== "all" || onlyOverdue);
  const reset = () => {
    setSearch("");
    setSource("all");
    setOnlyOverdue(false);
  };

  const kpiItems: TaskKpiItem[] = [
    {
      key: "todo",
      label: "To do",
      value: openTasks.length,
      hint: "Ready for you now",
      icon: ListTodoIcon,
      tone: "primary",
      active: !showDone && !onlyOverdue,
      onClick: !showDone ? () => setOnlyOverdue(false) : undefined,
    },
    {
      key: "overdue",
      label: "Overdue",
      value: overdueCount,
      hint: overdueCount > 0 ? "Finish these first" : "All caught up",
      icon: TriangleAlertIcon,
      tone: "destructive",
      active: !showDone && onlyOverdue,
      onClick: !showDone ? () => setOnlyOverdue((v) => !v) : undefined,
    },
    {
      key: "waiting",
      label: "Up next",
      value: waitingTasks.length,
      hint: "Waiting paper stages",
      icon: HourglassIcon,
      tone: "info",
    },
    {
      key: "done",
      label: "Done",
      value: doneTasks.length,
      hint: "Completed tasks",
      icon: CheckCheckIcon,
      tone: "success",
      active: showDone,
    },
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Sticker name="study" size={48} loop />
            <div className="space-y-0.5">
              <BlurText as="h1" text="My tasks" className="text-xl font-semibold tracking-tight sm:text-2xl" />
              <p className="text-muted-foreground text-xs">
                Work assigned to you. Click any task to inspect details, upload files, or log work.
              </p>
            </div>
          </div>

          <Tabs value={showDone ? "done" : "todo"}>
            <TabsList className="h-10 p-1">
              <TabsTrigger value="todo" asChild className="gap-1.5 px-3">
                <Link href="/tasks">
                  <CircleDotIcon className="text-primary size-3.5" />
                  <span>To do</span>
                  <Badge variant={showDone ? "secondary" : "default"} className="h-5 rounded-full px-1.5 text-[11px] tabular-nums">
                    {openTasks.length + waitingTasks.length}
                  </Badge>
                </Link>
              </TabsTrigger>
              <TabsTrigger value="done" asChild className="gap-1.5 px-3">
                <Link href="/tasks?show=done">
                  <CheckCircle2Icon className="text-success size-3.5" />
                  <span>Done</span>
                  <Badge variant={showDone ? "success" : "secondary"} className="h-5 rounded-full px-1.5 text-[11px] tabular-nums">
                    {doneTasks.length}
                  </Badge>
                </Link>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <TaskKpiStrip items={kpiItems} />

        {/* Search & Source Toolbar */}
        {baseList.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your tasks by title, role, or exam..."
                aria-label="Search my tasks"
                className="bg-card h-10 rounded-xl pr-9 pl-9 shadow-xs md:h-9"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full p-0.5"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={source}
                onValueChange={(v) => v && setSource(v as "all" | "tasks" | "papers")}
                aria-label="Filter by source"
                className="bg-card"
              >
                <ToggleGroupItem value="all" className="px-3 text-xs">
                  All
                </ToggleGroupItem>
                <ToggleGroupItem value="tasks" className="gap-1 px-3 text-xs">
                  <ListTodoIcon className="size-3.5" /> Tasks
                </ToggleGroupItem>
                <ToggleGroupItem value="papers" className="gap-1 px-3 text-xs">
                  <FileStackIcon className="size-3.5" /> Papers
                </ToggleGroupItem>
              </ToggleGroup>

              {hasFilters && (
                <Button type="button" variant="ghost" size="sm" onClick={reset} className="h-8 gap-1 text-xs">
                  <RotateCcwIcon className="size-3" /> Reset
                </Button>
              )}
            </div>
          </div>
        )}

        {visibleTasks.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={SearchXIcon}
              title="No matching tasks"
              description="Try clearing your search or filter to see your tasks."
              action={
                <Button variant="outline" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ListTodoIcon}
              art={showDone ? undefined : <Sticker name="study" size={120} loop />}
              title={showDone ? "Nothing finished yet" : "No tasks right now"}
              description={
                showDone
                  ? "Tasks you mark done will appear here."
                  : "When an admin gives you a task, it appears here and you get a notification."
              }
            />
          )
        ) : (
          <TaskGroups tasks={visibleTasks} render={(t) => <TaskRow key={t.id} task={t} mode="member" />} />
        )}
      </div>
    </TooltipProvider>
  );
}
