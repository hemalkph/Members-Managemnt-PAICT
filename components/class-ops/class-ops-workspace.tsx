"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  BookCopyIcon,
  BookOpenIcon,
  Building2Icon,
  CopyIcon,
  CornerDownLeftIcon,
  EllipsisVerticalIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  SchoolIcon,
  SplitIcon,
  TriangleAlertIcon,
  UploadIcon,
  WifiIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AddTutesDialog } from "@/components/class-ops/add-tutes-dialog";
import { ClassDialog, MODE_LABEL } from "@/components/class-ops/class-dialog";
import { ClassOpsRibbon } from "@/components/class-ops/class-ops-ribbon";
import { EmptyState } from "@/components/empty-state";
import { BookletEmblem } from "@/components/tutes/booklet-emblem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  assignClassTutesAction,
  copyClassTutesAction,
  removeClassTuteAction,
  saveClassPaidCountAction,
  undoClassPaidCountAction,
} from "@/lib/actions/class-ops";
import { checkPaidCountWarning, isPaidCountStale, paidProgressPct } from "@/lib/class-ops/helpers";
import type { ClassRow, PlannedTute, ShelfTute } from "@/lib/class-ops/queries";
import type { ActionResult } from "@/lib/core/action-result";
import { formatDateTime } from "@/lib/core/format";
import { monthLabel, shiftMonth, todayISO } from "@/lib/core/month";
import type { ClassMode } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type Batch = { id: string; name: string; isActive: boolean };
type AddDialogContext = { month?: string; classId?: string } | null;

const MODE_ICON: Record<ClassMode, typeof Building2Icon> = {
  physical: Building2Icon,
  online: WifiIcon,
  both: SplitIcon,
};

/** Classes grouped by batch, in the overview's order. */
function byBatch(classes: ClassRow[]) {
  const groups: { batchId: string; batchName: string; classes: ClassRow[] }[] = [];
  for (const c of classes) {
    const last = groups[groups.length - 1];
    if (last?.batchId === c.batch_id) last.classes.push(c);
    else groups.push({ batchId: c.batch_id, batchName: c.batch_name, classes: [c] });
  }
  return groups;
}

export function ClassOpsWorkspace({
  months,
  classes,
  batches,
  tutes,
  coverUrls,
  plan,
  month,
  tab: initialTab,
  canEdit,
}: {
  months: string[];
  classes: ClassRow[];
  batches: Batch[];
  tutes: ShelfTute[];
  coverUrls: Record<string, string>;
  plan: PlannedTute[];
  month: string;
  tab: "classes" | "plan";
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<"classes" | "plan">(initialTab);
  const [showArchived, setShowArchived] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);
  const [addContext, setAddContext] = useState<AddDialogContext>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const defaultBatchId = batches.find((b) => b.isActive)?.id ?? batches[0]?.id ?? "";
  const isThisMonth = month === todayISO().slice(0, 7);
  const nextMonth = shiftMonth(month, 1);

  const archivedCount = useMemo(() => classes.filter((c) => !c.is_active).length, [classes]);
  const activeGroups = useMemo(() => byBatch(classes.filter((c) => c.is_active)), [classes]);

  const visibleClasses = useMemo(
    () =>
      classes.filter((c) => {
        if (!showArchived && !c.is_active) return false;
        if (staleOnly && (!c.is_active || !isPaidCountStale(c.paid_at, isThisMonth))) return false;
        return true;
      }),
    [classes, showArchived, staleOnly, isThisMonth],
  );
  const visibleGroups = useMemo(() => byBatch(visibleClasses), [visibleClasses]);
  const typeableIds = useMemo(
    () => visibleClasses.filter((c) => canEdit && isThisMonth && c.is_active).map((c) => c.class_id),
    [visibleClasses, canEdit, isThisMonth],
  );

  const changeTab = (next: string) => {
    const val = next === "plan" ? "plan" : "classes";
    setActiveTab(val);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", val);
    window.history.replaceState(null, "", url);
  };

  const run = (fn: () => Promise<ActionResult<unknown>>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      after?.();
      router.refresh();
    });

  const handleSavePaidCount = (row: ClassRow, count: number, advanceFocus: boolean) =>
    startTransition(async () => {
      const res = await saveClassPaidCountAction({ class_id: row.class_id, count });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? `Saved: ${count} paid so far`, {
        action: {
          label: "Undo",
          onClick: () => run(() => undoClassPaidCountAction(row.class_id)),
        },
      });
      if (advanceFocus) {
        const idx = typeableIds.indexOf(row.class_id);
        if (idx >= 0 && idx < typeableIds.length - 1) {
          inputRefs.current.get(typeableIds[idx + 1])?.focus();
        }
      }
      router.refresh();
    });

  const handleRemovePlanned = (item: PlannedTute) =>
    startTransition(async () => {
      const res = await removeClassTuteAction(item.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Removed ${item.code || item.name} from ${monthLabel(item.month, "short")}`, {
        action: {
          label: "Undo",
          onClick: () =>
            run(() =>
              assignClassTutesAction({
                month: item.month,
                class_ids: [item.classId],
                tute_ids: [item.tuteId],
              }),
            ),
        },
      });
      router.refresh();
    });

  const handleCopyMonth = (classId: string, fromMonth: string, toMonth: string) =>
    run(() => copyClassTutesAction({ class_id: classId, from_month: fromMonth, to_month: toMonth }));

  const newClass = canEdit && batches.length > 0 && (
    <ClassDialog batches={batches} defaultBatchId={defaultBatchId} onSaved={() => router.refresh()}>
      <Button size="sm">
        <PlusIcon /> New class
      </Button>
    </ClassDialog>
  );

  if (classes.length === 0) {
    return (
      <EmptyState
        icon={SchoolIcon}
        title="No classes yet"
        description={
          batches.length === 0
            ? "Add a batch in Batches & exams first, then add its classes here."
            : "Add each class a batch runs (Physical, Online or both). Fee reminders, Tute stock and Speed Post use them."
        }
        action={newClass || undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      <ClassOpsRibbon
        classes={classes}
        month={month}
        isThisMonth={isThisMonth}
        staleOnly={activeTab === "classes" && staleOnly}
        onToggleStaleOnly={() => {
          setStaleOnly((v) => !v);
          if (activeTab !== "classes") changeTab("classes");
        }}
        onOpenPlan={() => changeTab("plan")}
      />

      <Tabs value={activeTab} onValueChange={changeTab} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <TabsList>
              <TabsTrigger value="classes">Classes &amp; counts</TabsTrigger>
              <TabsTrigger value="plan">
                <BookOpenIcon className="size-3.5" /> Tute plan
              </TabsTrigger>
            </TabsList>

            {activeTab === "classes" && staleOnly && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 gap-1.5 text-xs"
                onClick={() => setStaleOnly(false)}
              >
                <span>Needs update</span>
                <XIcon className="size-3" />
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeTab === "classes" && archivedCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setShowArchived((v) => !v)}>
                {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
              </Button>
            )}
            {canEdit && activeGroups.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setAddContext({ month })}>
                <BookOpenIcon /> Add tutes
              </Button>
            )}
            {newClass}
          </div>
        </div>

        {/* ----------------------------------------------- Classes & counts */}
        <TabsContent value="classes" className="space-y-5">
          {!isThisMonth && (
            <p className="text-muted-foreground text-sm">
              Showing {monthLabel(month)}. Paid counts can only be typed for this month.
            </p>
          )}

          {visibleGroups.length === 0 ? (
            <EmptyState
              icon={SchoolIcon}
              title={staleOnly ? "Every active class is up to date" : "No active classes"}
              description={
                staleOnly
                  ? "All active classes have a recent paid count for this month."
                  : "Tick In use on an archived class or add a new class."
              }
              action={
                staleOnly ? (
                  <Button size="sm" variant="outline" onClick={() => setStaleOnly(false)}>
                    Show all classes
                  </Button>
                ) : archivedCount > 0 ? (
                  <Button size="sm" variant="outline" onClick={() => setShowArchived(true)}>
                    Show archived ({archivedCount})
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="@container space-y-5">
              {visibleGroups.map((g) => (
                <section key={g.batchId} className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <h3 className="text-xs font-semibold">{g.batchName}</h3>
                    <span className="text-muted-foreground text-xs tabular-nums">{g.classes.length}</span>
                  </div>
                  <div className="bg-card divide-y overflow-hidden rounded-xl border">
                    {g.classes.map((c) => (
                      <ClassCountRow
                        key={c.class_id}
                        row={c}
                        month={month}
                        nextMonth={nextMonth}
                        isThisMonth={isThisMonth}
                        batches={batches}
                        canEdit={canEdit}
                        canType={canEdit && isThisMonth && c.is_active}
                        pending={pending}
                        registerInput={(el) => {
                          if (el) inputRefs.current.set(c.class_id, el);
                          else inputRefs.current.delete(c.class_id);
                        }}
                        onSave={(count, advance) => handleSavePaidCount(c, count, advance)}
                        onOpenAddTutes={(targetMonth) => setAddContext({ month: targetMonth, classId: c.class_id })}
                        onSaved={() => router.refresh()}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <p className="text-muted-foreground px-1 text-xs">
            <span className="text-foreground font-medium">Paid so far</span> is the newest of the uploaded paid list
            (Fee reminders) and a count typed here. Press <Kbd>↵</Kbd> after typing a count to save and jump to the next
            class.
          </p>
        </TabsContent>

        {/* ------------------------------------------------------ Tute plan */}
        <TabsContent value="plan" className="space-y-4">
          {activeGroups.length === 0 ? (
            <EmptyState icon={BookOpenIcon} title="No classes in use" description="Add a class or tick In use on one." />
          ) : (
            <TooltipProvider delayDuration={200}>
              {/* Desktop 3-month matrix */}
              <div className="bg-card hidden overflow-x-auto rounded-xl border md:block">
                <table className="w-full min-w-[720px] table-fixed text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left text-xs">
                      <th className="w-[230px] px-4 py-2.5 font-medium">Class</th>
                      {months.map((m) => {
                        const monthTotal = plan.filter((p) => p.month === m).length;
                        const activeIds = new Set(activeGroups.flatMap((g) => g.classes.map((c) => c.class_id)));
                        const missingCount = [...activeIds].filter(
                          (cid) => !plan.some((p) => p.classId === cid && p.month === m),
                        ).length;
                        return (
                          <th key={m} className="px-3 py-2.5 font-medium">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-foreground font-semibold">{monthLabel(m)}</span>
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-normal tabular-nums">
                                {monthTotal} scheduled
                                {missingCount > 0 && (
                                  <span
                                    className="bg-amber-500 dark:bg-warning size-1.5 rounded-full"
                                    title={`${missingCount} class${missingCount === 1 ? "" : "es"} with no tutes planned`}
                                  />
                                )}
                              </span>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {activeGroups.map((g) => (
                      <PlanBatchRows
                        key={g.batchId}
                        batchName={g.batchName}
                        classes={g.classes}
                        months={months}
                        plan={plan}
                        coverUrls={coverUrls}
                        canEdit={canEdit}
                        pending={pending}
                        onAddCell={(classId, targetMonth) => setAddContext({ classId, month: targetMonth })}
                        onCopyMonth={handleCopyMonth}
                        onRemove={handleRemovePlanned}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Phone-first stacked cards (no horizontal scrolling) */}
              <div className="space-y-4 md:hidden">
                {activeGroups.map((g) => (
                  <section key={g.batchId} className="space-y-2">
                    <h3 className="px-1 text-xs font-semibold">{g.batchName}</h3>
                    <div className="space-y-2.5">
                      {g.classes.map((c) => {
                        const ModeIcon = MODE_ICON[c.mode];
                        return (
                          <div key={c.class_id} className="bg-card divide-y overflow-hidden rounded-xl border">
                            <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                              <p className="text-sm font-semibold">{c.name}</p>
                              <Badge variant="outline" className="gap-1 text-[10px]">
                                <ModeIcon className="size-3" /> {MODE_LABEL[c.mode]}
                              </Badge>
                            </div>
                            {months.map((m, mIdx) => {
                              const items = plan.filter((p) => p.classId === c.class_id && p.month === m);
                              const prevMonth = mIdx > 0 ? months[mIdx - 1] : null;
                              const prevCount = prevMonth
                                ? plan.filter((p) => p.classId === c.class_id && p.month === prevMonth).length
                                : 0;
                              return (
                                <div key={m} className="space-y-2 px-3.5 py-2.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground text-xs font-medium">{monthLabel(m)}</span>
                                    {canEdit && (
                                      <div className="flex items-center gap-1.5">
                                        {items.length === 0 && prevMonth && prevCount > 0 && (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            disabled={pending}
                                            className="h-6 px-2 text-[11px]"
                                            onClick={() => handleCopyMonth(c.class_id, prevMonth, m)}
                                          >
                                            <CopyIcon className="size-3" /> Copy {monthLabel(prevMonth, "short")} ({prevCount})
                                          </Button>
                                        )}
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          className="h-6 px-2 text-[11px]"
                                          onClick={() => setAddContext({ classId: c.class_id, month: m })}
                                        >
                                          <PlusIcon className="size-3" /> Add
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                  {items.length === 0 ? (
                                    <p className="text-muted-foreground text-xs">No tutes planned yet.</p>
                                  ) : (
                                    <ul className="space-y-1.5">
                                      {items.map((p) => (
                                        <li
                                          key={p.id}
                                          className="bg-muted/35 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
                                        >
                                          <div className="flex min-w-0 items-center gap-2">
                                            <BookletEmblem
                                              name={p.name}
                                              code={p.code}
                                              coverUrl={coverUrls[p.tuteId] ?? null}
                                              className="h-8 w-6 shrink-0 text-[8px]"
                                            />
                                            <div className="min-w-0">
                                              <p className="truncate font-medium">{p.name}</p>
                                              {p.code && (
                                                <p className="text-muted-foreground font-mono text-[10px]">{p.code}</p>
                                              )}
                                            </div>
                                          </div>
                                          {canEdit && (
                                            <button
                                              type="button"
                                              disabled={pending}
                                              onClick={() => handleRemovePlanned(p)}
                                              className="text-muted-foreground hover:text-destructive shrink-0 rounded-md p-1.5"
                                              aria-label={`Remove ${p.name} from ${c.name} in ${monthLabel(m)}`}
                                            >
                                              <XIcon className="size-3.5" />
                                            </button>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </TooltipProvider>
          )}
        </TabsContent>
      </Tabs>

      {addContext && (
        <AddTutesDialog
          months={months}
          groups={activeGroups}
          tutes={tutes}
          coverUrls={coverUrls}
          plan={plan}
          initialMonth={addContext.month}
          initialClassId={addContext.classId}
          pending={pending}
          run={(fn) => run(fn, () => setAddContext(null))}
          onClose={() => setAddContext(null)}
        />
      )}
    </div>
  );
}

function ClassCountRow({
  row,
  month,
  nextMonth,
  isThisMonth,
  batches,
  canEdit,
  canType,
  pending,
  registerInput,
  onSave,
  onOpenAddTutes,
  onSaved,
}: {
  row: ClassRow;
  month: string;
  nextMonth: string;
  isThisMonth: boolean;
  batches: Batch[];
  canEdit: boolean;
  canType: boolean;
  pending: boolean;
  registerInput: (el: HTMLInputElement | null) => void;
  onSave: (count: number, advanceFocus: boolean) => void;
  onOpenAddTutes: (targetMonth: string) => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [armedWarning, setArmedWarning] = useState<string | null>(null);

  const n = value.trim() === "" ? null : Number(value);
  const valid = n !== null && Number.isInteger(n) && n >= 0 && n <= 100000;
  const stale = row.is_active && isPaidCountStale(row.paid_at, isThisMonth);
  const pct = paidProgressPct(row.paid, row.expected);
  const ModeIcon = MODE_ICON[row.mode];

  const attemptSave = (advanceFocus: boolean) => {
    if (!valid || pending || n === null) return;
    const warning = checkPaidCountWarning(n, row.paid, row.last_month);
    if (warning && armedWarning !== warning) {
      setArmedWarning(warning);
      return;
    }
    setArmedWarning(null);
    onSave(n, advanceFocus);
    setValue("");
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-3.5 transition-colors",
        "@3xl:grid @3xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1.15fr)_auto] @3xl:items-center @3xl:gap-4",
        !row.is_active && "opacity-65",
      )}
    >
      {/* Zone 1: Class Identity + Mode + Freshness */}
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <ModeIcon className="size-3" /> {MODE_LABEL[row.mode]}
          </Badge>
          {!row.is_active && (
            <Badge variant="secondary" className="text-[10px]">
              Archived
            </Badge>
          )}
          {stale && (
            <Badge variant="warning" className="text-[10px]">
              Needs update
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-xs tabular-nums">
          {row.paid === null ? (
            "No paid count yet this month"
          ) : (
            <>
              {row.paid_source === "typed" ? "Typed" : "Paid list"} · {formatDateTime(row.paid_at)}
            </>
          )}
          {row.last_month !== null && <> · Last month {row.last_month}</>}
        </p>
      </div>

      {/* Zone 2: Paid vs Expected Progress Bar + Clickable Tute Plan Pills */}
      <div className="min-w-0 space-y-2">
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
            <span>
              <span className="text-foreground font-semibold">{row.paid ?? 0}</span>
              <span className="text-muted-foreground"> / {row.expected} planned</span>
            </span>
            {row.expected > 0 && <span className="text-muted-foreground text-[11px]">{pct}%</span>}
          </div>
          <Progress value={pct} className="h-1.5" aria-label={`${pct}% of planned students paid`} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {canEdit && row.is_active ? (
            <>
              <button
                type="button"
                onClick={() => onOpenAddTutes(month)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
                  row.tutes_this === 0
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-warning"
                    : "bg-muted/40 hover:bg-accent text-foreground border-border",
                )}
              >
                {monthLabel(month, "short")}: {row.tutes_this} tute{row.tutes_this === 1 ? "" : "s"}
              </button>
              <button
                type="button"
                onClick={() => onOpenAddTutes(nextMonth)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
                  row.tutes_next === 0
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-warning"
                    : "bg-muted/40 hover:bg-accent text-muted-foreground hover:text-foreground border-border",
                )}
              >
                {monthLabel(nextMonth, "short")}: {row.tutes_next}
              </button>
            </>
          ) : (
            <span className="text-muted-foreground text-xs tabular-nums">
              {monthLabel(month, "short")}: {row.tutes_this} · {monthLabel(nextMonth, "short")}: {row.tutes_next}
            </span>
          )}
        </div>
      </div>

      {/* Zone 3: Inline Paid Count Entry + Typo Guard + Actions */}
      <div className="flex flex-col items-stretch gap-1.5 @3xl:items-end">
        <div className="flex items-center justify-end gap-1.5">
          {canType && (
            <InputGroup className={cn("h-8 w-44 bg-background", armedWarning && "border-amber-500/60")}>
              <InputGroupInput
                ref={registerInput}
                type="number"
                inputMode="numeric"
                min={0}
                max={100000}
                step={1}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setArmedWarning(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    attemptSave(true);
                  }
                }}
                placeholder="Paid today…"
                aria-label={`Paid so far for ${row.name}`}
                className="h-8 px-2.5 text-right text-xs tabular-nums"
              />
              <InputGroupAddon align="inline-end" className="pr-1">
                <InputGroupButton
                  size="xs"
                  variant={armedWarning ? "default" : "secondary"}
                  disabled={!valid || pending}
                  onClick={() => attemptSave(false)}
                  className="h-6 px-2 text-[11px]"
                >
                  {pending ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : (
                    <CornerDownLeftIcon className="size-3" />
                  )}
                  {armedWarning ? "Confirm" : "Save"}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          )}

          {canEdit && (
            <>
              <ClassDialog
                batches={batches}
                defaultBatchId={row.batch_id}
                editing={{ id: row.class_id, batchId: row.batch_id, name: row.name, mode: row.mode, isActive: row.is_active }}
                onSaved={onSaved}
              >
                <Button size="icon-sm" variant="ghost" className="size-8" aria-label={`Edit ${row.name}`}>
                  <PencilIcon className="size-4" />
                </Button>
              </ClassDialog>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" className="size-8" aria-label={`More for ${row.name}`}>
                    <EllipsisVerticalIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {row.is_active && (
                    <DropdownMenuItem onSelect={() => onOpenAddTutes(month)}>
                      <BookOpenIcon className="size-3.5" /> Add tutes ({monthLabel(month, "short")})
                    </DropdownMenuItem>
                  )}
                  {row.is_active && (
                    <DropdownMenuItem onSelect={() => onOpenAddTutes(nextMonth)}>
                      <PlusIcon className="size-3.5" /> Plan {monthLabel(nextMonth, "short")} tutes
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <Link href="/admin/fee-reminders">
                      <UploadIcon className="size-3.5" /> Upload paid list
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/admin/tutes?month=${month}`}>
                      <BookCopyIcon className="size-3.5" /> Open Tute stock
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>

        {armedWarning && (
          <p className="flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-warning">
            <TriangleAlertIcon className="size-3 shrink-0" />
            <span>{armedWarning}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function PlanBatchRows({
  batchName,
  classes,
  months,
  plan,
  coverUrls,
  canEdit,
  pending,
  onAddCell,
  onCopyMonth,
  onRemove,
}: {
  batchName: string;
  classes: ClassRow[];
  months: string[];
  plan: PlannedTute[];
  coverUrls: Record<string, string>;
  canEdit: boolean;
  pending: boolean;
  onAddCell: (classId: string, month: string) => void;
  onCopyMonth: (classId: string, fromMonth: string, toMonth: string) => void;
  onRemove: (item: PlannedTute) => void;
}) {
  return (
    <>
      <tr className="bg-muted/40 border-b">
        <td colSpan={months.length + 1} className="px-4 py-1.5 text-xs font-semibold">
          {batchName}
        </td>
      </tr>
      {classes.map((c) => {
        const ModeIcon = MODE_ICON[c.mode];
        return (
          <tr key={c.class_id} className="border-b align-top last:border-b-0">
            <td className="px-4 py-3">
              <p className="font-semibold">{c.name}</p>
              <p className="text-muted-foreground mt-0.5 inline-flex items-center gap-1 text-xs">
                <ModeIcon className="size-3" /> {MODE_LABEL[c.mode]}
              </p>
            </td>
            {months.map((m, mIdx) => {
              const items = plan.filter((p) => p.classId === c.class_id && p.month === m);
              const prevMonth = mIdx > 0 ? months[mIdx - 1] : null;
              const prevCount = prevMonth
                ? plan.filter((p) => p.classId === c.class_id && p.month === prevMonth).length
                : 0;

              return (
                <td key={m} className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {items.map((p) => {
                      const coverUrl = coverUrls[p.tuteId] ?? null;
                      return (
                        <Tooltip key={p.id}>
                          <TooltipTrigger asChild>
                            <span className="bg-secondary/75 inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs">
                              {coverUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element -- Private signed Supabase URL
                                <img
                                  src={coverUrl}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  className="size-4 shrink-0 rounded-[3px] object-cover"
                                />
                              ) : null}
                              <span className={cn("truncate", p.code && "font-mono text-[11px]")}>
                                {p.code || p.name}
                              </span>
                              {canEdit && (
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => onRemove(p)}
                                  className="text-muted-foreground hover:text-destructive -mr-0.5 cursor-pointer rounded-sm p-0.5 transition-colors"
                                  aria-label={`Remove ${p.name} from ${c.name} in ${monthLabel(m)}`}
                                >
                                  <XIcon className="size-3" />
                                </button>
                              )}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            {p.name}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}

                    {canEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() => onAddCell(c.class_id, m)}
                          className="text-muted-foreground hover:text-foreground hover:border-foreground/30 inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-dashed px-2 text-[11px] transition-colors"
                        >
                          <PlusIcon className="size-3" /> Add
                        </button>
                        {items.length === 0 && prevMonth && prevCount > 0 && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => onCopyMonth(c.class_id, prevMonth, m)}
                            className="text-muted-foreground hover:text-primary inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[11px] transition-colors"
                          >
                            <CopyIcon className="size-3" /> Copy {monthLabel(prevMonth, "short")} ({prevCount})
                          </button>
                        )}
                      </>
                    )}

                    {!canEdit && items.length === 0 && <span className="text-muted-foreground text-xs">—</span>}
                  </div>
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
