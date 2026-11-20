"use client";

import {
  CheckCircle2Icon,
  CircleDotIcon,
  FileStackIcon,
  FlameIcon,
  ListTodoIcon,
  PaperclipIcon,
  RotateCcwIcon,
  SearchIcon,
  TriangleAlertIcon,
  Undo2Icon,
  XCircleIcon,
  XIcon,
  AlarmClockIcon,
} from "lucide-react";
import { useUrlFilters } from "@/components/admin/url-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type UrgencyFilter = "all" | "overdue" | "due_soon" | "high" | "sent_back";
export type SourceFilter = "all" | "tasks" | "papers";

export function TaskFilters({
  view,
  counts,
  overdueTotal,
  member,
  role,
  exam,
  type,
  members,
  roles,
  exams,
  types,
  search,
  onSearchChange,
  urgency,
  onUrgencyChange,
  source,
  onSourceChange,
  needsReviewOnly,
  onNeedsReviewChange,
  needsReviewCount,
  urgencyCounts,
  hasActiveFilters,
  onResetAll,
}: {
  view: string;
  counts: { open: number; done: number; cancelled: number };
  overdueTotal: number;
  member: string;
  role: string;
  exam: string;
  type: string;
  members: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  exams: { id: string; label: string }[];
  types: { id: string; label: string }[];
  search: string;
  onSearchChange: (q: string) => void;
  urgency: UrgencyFilter;
  onUrgencyChange: (u: UrgencyFilter) => void;
  source: SourceFilter;
  onSourceChange: (s: SourceFilter) => void;
  needsReviewOnly: boolean;
  onNeedsReviewChange: (v: boolean) => void;
  needsReviewCount: number;
  urgencyCounts: { overdue: number; dueSoon: number; high: number; sentBack: number };
  hasActiveFilters: boolean;
  onResetAll: () => void;
}) {
  const { setParams, pending } = useUrlFilters();

  const handleViewChange = (next: string) => {
    onUrgencyChange("all");
    onNeedsReviewChange(false);
    setParams({ view: next === "open" ? null : next });
  };

  return (
    <div className={cn("space-y-3", pending && "opacity-70 transition-opacity")}>
      {/* Row 1: Open / Done / Cancelled Status Tabs + Source Toggle */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={view} onValueChange={handleViewChange}>
          <TabsList className="h-10 p-1">
            <TabsTrigger value="open" className="gap-1.5 px-3">
              <CircleDotIcon className="text-primary size-3.5" />
              <span>Open</span>
              <Badge
                variant={view === "open" ? "default" : "secondary"}
                className="h-5 min-w-5 rounded-full px-1.5 text-[11px] tabular-nums"
              >
                {counts.open}
              </Badge>
              {overdueTotal > 0 && view !== "open" && (
                <span
                  className="bg-destructive size-2 rounded-full"
                  title={`${overdueTotal} overdue`}
                  aria-label={`${overdueTotal} overdue`}
                />
              )}
            </TabsTrigger>

            <TabsTrigger value="done" className="gap-1.5 px-3">
              <CheckCircle2Icon className="text-success size-3.5" />
              <span>Done</span>
              <Badge
                variant={view === "done" ? "success" : "secondary"}
                className="h-5 min-w-5 rounded-full px-1.5 text-[11px] tabular-nums"
              >
                {counts.done}
              </Badge>
            </TabsTrigger>

            <TabsTrigger value="cancelled" className="gap-1.5 px-3">
              <XCircleIcon className="text-rose-500 dark:text-rose-400 size-3.5" />
              <span>Cancelled</span>
              <Badge variant="secondary" className="h-5 min-w-5 rounded-full px-1.5 text-[11px] tabular-nums">
                {counts.cancelled}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Source filter: All | Tasks | Paper stages */}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={source}
          onValueChange={(v) => v && onSourceChange(v as SourceFilter)}
          aria-label="Filter by task source"
          className="bg-card"
        >
          <ToggleGroupItem value="all" className="px-3 text-xs">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="tasks" className="gap-1.5 px-3 text-xs">
            <ListTodoIcon className="size-3.5" />
            Tasks
          </ToggleGroupItem>
          <ToggleGroupItem value="papers" className="gap-1.5 px-3 text-xs">
            <FileStackIcon className="size-3.5" />
            Paper stages
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Row 2: Wide Search Bar + Compact Filter Dropdowns (Reference Image 1 Toolbar!) */}
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="relative flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks by title, member, role, exam, or note..."
            aria-label="Search tasks"
            className="bg-card h-10 rounded-xl pr-9 pl-9 shadow-xs md:h-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full p-0.5 transition-colors"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:flex xl:shrink-0">
          <Select value={member || "all"} onValueChange={(v) => setParams({ member: v })}>
            <SelectTrigger className="bg-card rounded-xl xl:w-40" aria-label="Member">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All members</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {roles.length > 0 && (
            <Select value={role || "all"} onValueChange={(v) => setParams({ role: v })}>
              <SelectTrigger className="bg-card rounded-xl xl:w-38" aria-label="Role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={exam || "all"} onValueChange={(v) => setParams({ exam: v })}>
            <SelectTrigger className="bg-card rounded-xl xl:w-42" aria-label="Exam">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All exams</SelectItem>
              {exams.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {types.length > 0 && (
            <Select value={type || "all"} onValueChange={(v) => setParams({ type: v })}>
              <SelectTrigger className="bg-card rounded-xl xl:w-42" aria-label="Task type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Row 3: Quick Urgency / Review Chips + Clear Filters */}
      {(view === "open" || (view === "done" && needsReviewCount > 0) || hasActiveFilters) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {view === "open" && (
            <>
              <QuickChip
                active={urgency === "all"}
                onClick={() => onUrgencyChange("all")}
                label="All open"
              />
              <QuickChip
                active={urgency === "overdue"}
                onClick={() => onUrgencyChange(urgency === "overdue" ? "all" : "overdue")}
                label="Overdue"
                count={urgencyCounts.overdue}
                icon={TriangleAlertIcon}
                tone="destructive"
              />
              <QuickChip
                active={urgency === "due_soon"}
                onClick={() => onUrgencyChange(urgency === "due_soon" ? "all" : "due_soon")}
                label="Due in 7 days"
                count={urgencyCounts.dueSoon}
                icon={AlarmClockIcon}
                tone="warning"
              />
              {urgencyCounts.high > 0 && (
                <QuickChip
                  active={urgency === "high"}
                  onClick={() => onUrgencyChange(urgency === "high" ? "all" : "high")}
                  label="High priority"
                  count={urgencyCounts.high}
                  icon={FlameIcon}
                  tone="destructive"
                />
              )}
              {urgencyCounts.sentBack > 0 && (
                <QuickChip
                  active={urgency === "sent_back"}
                  onClick={() => onUrgencyChange(urgency === "sent_back" ? "all" : "sent_back")}
                  label="Sent back"
                  count={urgencyCounts.sentBack}
                  icon={Undo2Icon}
                  tone="destructive"
                />
              )}
            </>
          )}

          {view === "done" && needsReviewCount > 0 && (
            <QuickChip
              active={needsReviewOnly}
              onClick={() => onNeedsReviewChange(!needsReviewOnly)}
              label="New files / Check fix"
              count={needsReviewCount}
              icon={PaperclipIcon}
              tone="warning"
            />
          )}

          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onResetAll}
              className="text-muted-foreground hover:text-foreground ml-auto h-7 gap-1 rounded-full px-2.5 text-xs"
            >
              <RotateCcwIcon className="size-3" /> Clear filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function QuickChip({
  active,
  onClick,
  label,
  count,
  icon: Icon,
  tone = "default",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  icon?: typeof TriangleAlertIcon;
  tone?: "default" | "destructive" | "warning";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-all",
        active
          ? tone === "destructive"
            ? "border-destructive/40 bg-destructive text-white shadow-xs"
            : tone === "warning"
              ? "border-amber-500/40 bg-amber-500/20 text-amber-800 dark:text-warning"
              : "border-primary/40 bg-primary text-primary-foreground shadow-xs"
          : "bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground border-border",
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            "size-3",
            !active && tone === "destructive" && "text-destructive",
            !active && tone === "warning" && "text-amber-600 dark:text-warning",
          )}
        />
      )}
      <span>{label}</span>
      {typeof count === "number" && (
        <span
          className={cn(
            "rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
            active ? "bg-black/15 dark:bg-white/15" : "bg-muted text-foreground/80",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
