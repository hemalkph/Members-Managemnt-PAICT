"use client";

import { useMemo, useState } from "react";
import {
  AlarmClockIcon,
  CheckCheckIcon,
  CheckCircle2Icon,
  ListTodoIcon,
  PlusIcon,
  SearchXIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { useUrlFilters } from "@/components/admin/url-filters";
import { EmptyState } from "@/components/empty-state";
import BlurText from "@/components/reactbits/blur-text";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { TaskView } from "@/lib/tasks/queries";
import { TaskDialog, type TaskFormOptions } from "./task-dialog";
import { TaskFilters, type SourceFilter, type UrgencyFilter } from "./task-filters";
import { TaskGroups } from "./task-groups";
import { TaskKpiStrip, type TaskKpiItem } from "./task-kpi-strip";
import { TaskRow } from "./task-row";
import { TaskTypesButton } from "./task-type-manager";

/**
 * Full Admin Tasks Workspace modeled after the reference portal layout:
 * Header (title + summary + Task types + Assign a task) → 4 interactive KPI cards →
 * Open/Done/Cancelled tabs + Search & faceted filters → Expandable horizontal TaskRows.
 */
export function AdminTaskBoard({
  view,
  tasks,
  counts,
  kpis,
  filters,
  options,
  allMembers,
  allExams,
  today,
  phones = {},
  readOnly = false,
}: {
  view: "open" | "done" | "cancelled";
  tasks: TaskView[];
  counts: { open: number; done: number; cancelled: number };
  kpis: { open: number; overdue: number; dueThisWeek: number; done30Days: number };
  filters: { member: string; role: string; exam: string; type: string };
  options: TaskFormOptions;
  allMembers: { id: string; name: string }[];
  allExams: { id: string; label: string }[];
  today: string;
  phones?: Record<string, string>;
  readOnly?: boolean;
}) {
  const { setParams } = useUrlFilters();
  const [dialog, setDialog] = useState<{ task: TaskView | null; key: number } | null>(null);
  const [search, setSearch] = useState("");
  const [urgency, setUrgency] = useState<UrgencyFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);

  const weekAhead = useMemo(
    () => new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10),
    [today],
  );

  // Per-view counts for quick chips (based on currently server-filtered tasks)
  const urgencyCounts = useMemo(
    () => ({
      overdue: tasks.filter((t) => t.status === "open" && t.overdue).length,
      dueSoon: tasks.filter((t) => t.status === "open" && Boolean(t.dueDate && t.dueDate >= today && t.dueDate <= weekAhead)).length,
      high: tasks.filter((t) => t.status === "open" && t.priority === "high").length,
      sentBack: tasks.filter((t) => t.status === "open" && Boolean(t.fixNote)).length,
    }),
    [tasks, today, weekAhead],
  );

  const needsReviewCount = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.status === "done" &&
          (Boolean(t.sentBackAt) || t.files.some((f) => f.kind === "work" && !f.seen)),
      ).length,
    [tasks],
  );

  // Client-side instant search + quick-chip filtering + smart sorting
  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = tasks.filter((t) => {
      if (source === "tasks" && t.paperId) return false;
      if (source === "papers" && !t.paperId) return false;

      if (view === "open") {
        if (urgency === "overdue" && !(t.status === "open" && t.overdue)) return false;
        if (urgency === "due_soon" && !(t.status === "open" && t.dueDate && t.dueDate >= today && t.dueDate <= weekAhead))
          return false;
        if (urgency === "high" && !(t.status === "open" && t.priority === "high")) return false;
        if (urgency === "sent_back" && !(t.status === "open" && Boolean(t.fixNote))) return false;
      }

      if (view === "done" && needsReviewOnly) {
        const hasNewWork = t.files.some((f) => f.kind === "work" && !f.seen);
        if (!t.sentBackAt && !hasNewWork) return false;
      }

      if (q) {
        const hay = [
          t.title,
          t.description,
          t.assigneeName,
          t.roleName,
          t.examLabel,
          t.centreName,
          t.typeName,
          t.fixNote,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (view === "open") {
      // Overdue first → Sent back → High priority → Open before waiting → Earliest due date
      return [...filtered].sort((a, b) => {
        const rank = (t: TaskView) => {
          if (t.status === "waiting") return 4;
          if (t.overdue) return 0;
          if (t.fixNote) return 1;
          if (t.priority === "high") return 2;
          return 3;
        };
        return rank(a) - rank(b) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
      });
    }

    if (view === "done") {
      // Unseen work / fixed-again near top, otherwise newest completed first
      return [...filtered].sort((a, b) => {
        const attention = (t: TaskView) =>
          Number(Boolean(t.sentBackAt) || t.files.some((f) => f.kind === "work" && !f.seen));
        return (
          attention(b) - attention(a) ||
          (b.completedAt ?? b.dueDate ?? "").localeCompare(a.completedAt ?? a.dueDate ?? "")
        );
      });
    }

    return filtered;
  }, [tasks, search, source, urgency, needsReviewOnly, view, today, weekAhead]);

  const hasServerFilters = Boolean(filters.member || filters.role || filters.exam || filters.type);
  const hasClientFilters = Boolean(search.trim() || urgency !== "all" || source !== "all" || needsReviewOnly);
  const hasActiveFilters = hasServerFilters || hasClientFilters;

  const resetAllFilters = () => {
    setSearch("");
    setUrgency("all");
    setSource("all");
    setNeedsReviewOnly(false);
    if (hasServerFilters) {
      setParams({ member: null, role: null, exam: null, type: null });
    }
  };

  // Interactive 4-card KPI strip (clicking toggles corresponding filter!)
  const kpiItems: TaskKpiItem[] = [
    {
      key: "open",
      label: "Open tasks",
      value: kpis.open,
      hint: `${counts.open} total including up next`,
      icon: ListTodoIcon,
      tone: "primary",
      active: view === "open" && urgency === "all",
      onClick: () => {
        setUrgency("all");
        setNeedsReviewOnly(false);
        if (view !== "open") setParams({ view: null });
      },
    },
    {
      key: "overdue",
      label: "Overdue",
      value: kpis.overdue,
      hint: kpis.overdue > 0 ? "Needs follow-up now" : "Everything on schedule",
      icon: TriangleAlertIcon,
      tone: "destructive",
      active: view === "open" && urgency === "overdue",
      onClick: () => {
        const next = view === "open" && urgency === "overdue" ? "all" : "overdue";
        setUrgency(next);
        if (view !== "open") setParams({ view: null });
      },
    },
    {
      key: "due_week",
      label: "Due in 7 days",
      value: kpis.dueThisWeek,
      hint: "Upcoming this week",
      icon: AlarmClockIcon,
      tone: "info",
      active: view === "open" && urgency === "due_soon",
      onClick: () => {
        const next = view === "open" && urgency === "due_soon" ? "all" : "due_soon";
        setUrgency(next);
        if (view !== "open") setParams({ view: null });
      },
    },
    {
      key: "done_30",
      label: "Done (30 days)",
      value: kpis.done30Days,
      hint: `${counts.done} completed all-time`,
      icon: CheckCheckIcon,
      tone: "success",
      active: view === "done",
      onClick: () => {
        setUrgency("all");
        setParams({ view: "done" });
      },
    },
  ];

  // Contextual empty state per view + filter state
  const emptyConfig = (() => {
    if (hasActiveFilters) {
      return {
        icon: SearchXIcon,
        title: "No tasks match your filters",
        description: "Try adjusting your search query or clearing one of the active filters.",
        action: (
          <Button variant="outline" size="sm" onClick={resetAllFilters}>
            Clear all filters
          </Button>
        ),
      };
    }
    if (view === "done") {
      return {
        icon: CheckCircle2Icon,
        title: "No completed tasks yet",
        description: "Finished tasks and member hand-ins will appear here for quick review.",
        action: undefined,
      };
    }
    if (view === "cancelled") {
      return {
        icon: XCircleIcon,
        title: "No cancelled tasks",
        description: "Cancelled tasks are kept here in case you want to restore or review them later.",
        action: undefined,
      };
    }
    return {
      icon: ListTodoIcon,
      title: "All caught up — no open tasks",
      description: "Assign work with a due date, role, and files to any team member.",
      action: !readOnly ? (
        <Button size="sm" onClick={() => setDialog({ task: null, key: Date.now() })}>
          <PlusIcon /> Assign a task
        </Button>
      ) : undefined,
    };
  })();

  const liveSubtitle =
    view === "open"
      ? `${counts.open} open — ${kpis.overdue} overdue · ${visibleTasks.length} shown`
      : view === "done"
        ? `${counts.done} completed — ${needsReviewCount > 0 ? `${needsReviewCount} waiting for review` : `${kpis.done30Days} in the last 30 days`}`
        : `${counts.cancelled} cancelled — restore any task in one click`;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        {/* Header Bar: Title + Live Subtitle on left, Secondary + Primary actions side-by-side on right (Image 1!) */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="bg-primary/10 text-primary border-primary/15 hidden size-9 shrink-0 items-center justify-center rounded-lg border sm:flex">
              <ListTodoIcon className="size-4.5" />
            </span>
            <div className="space-y-0.5">
              <BlurText as="h1" text="Tasks" className="text-xl font-semibold tracking-tight sm:text-2xl" />
              <p className="text-muted-foreground text-xs">{liveSubtitle}</p>
            </div>
          </div>

          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <TaskTypesButton types={options.types} options={options} />
              <Button onClick={() => setDialog({ task: null, key: Date.now() })} className="shadow-xs">
                <PlusIcon /> Assign a task
              </Button>
            </div>
          )}
        </div>

        {readOnly && <ReadOnlyNotice />}

        {/* 4 Interactive KPI Stat Cards */}
        <TaskKpiStrip items={kpiItems} />

        {/* Status Tabs + Wide Search & Filter Bar */}
        <TaskFilters
          view={view}
          counts={counts}
          overdueTotal={kpis.overdue}
          member={filters.member}
          role={filters.role}
          exam={filters.exam}
          type={filters.type}
          members={allMembers}
          roles={options.roles}
          exams={allExams}
          types={options.types.map((t) => ({ id: t.id, label: t.name }))}
          search={search}
          onSearchChange={setSearch}
          urgency={urgency}
          onUrgencyChange={setUrgency}
          source={source}
          onSourceChange={setSource}
          needsReviewOnly={needsReviewOnly}
          onNeedsReviewChange={setNeedsReviewOnly}
          needsReviewCount={needsReviewCount}
          urgencyCounts={urgencyCounts}
          hasActiveFilters={hasActiveFilters}
          onResetAll={resetAllFilters}
        />

        {/* Task List (Full-Width Expandable Horizontal Rows) */}
        {visibleTasks.length === 0 ? (
          <EmptyState
            icon={emptyConfig.icon}
            title={emptyConfig.title}
            description={emptyConfig.description}
            action={emptyConfig.action}
          />
        ) : (
          <TaskGroups
            tasks={visibleTasks}
            render={(t) => (
              <TaskRow
                key={t.id}
                task={t}
                mode="admin"
                readOnly={readOnly}
                whatsapp={phones[t.assigneeId]}
                onEdit={(task) => setDialog({ task, key: Date.now() })}
              />
            )}
          />
        )}

        {/* Create / Edit Task Dialog */}
        {dialog && (
          <TaskDialog
            key={dialog.key}
            open
            onOpenChange={(open) => !open && setDialog(null)}
            task={dialog.task}
            options={options}
            today={today}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
