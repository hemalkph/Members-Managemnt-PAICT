"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookOpenIcon,
  CalendarPlusIcon,
  Link2Icon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  attachClassMonthTuteAction,
  createAndAssignClassTuteAction,
  deleteClassTuteAction,
  removeClassMonthTuteAction,
  reorderClassMonthTutesAction,
  updateClassTuteAction,
} from "@/lib/actions/fees";
import { monthLabel, shiftMonth } from "@/lib/core/month";
import type { ClassTuteCatalogItem, ScheduledMonthTute } from "@/lib/fees/queries";
import { cn } from "@/lib/utils";

function buildPlanMonths(baseMonth: string, existingMonths: string[]): string[] {
  const set = new Set<string>(existingMonths);
  // 6 months back through 12 future months ahead so staff can pre-plan upcoming tutes.
  for (let d = -6; d <= 12; d++) {
    set.add(shiftMonth(baseMonth, d));
  }
  return [...set].sort();
}

export function TutesManager({
  batchId,
  batchName,
  classId,
  className,
  defaultMonth,
  catalog,
  scheduled,
  canEdit,
}: {
  batchId: string;
  batchName: string;
  classId: string;
  className: string;
  defaultMonth: string;
  catalog: ClassTuteCatalogItem[];
  scheduled: ScheduledMonthTute[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [prevDefaultKey, setPrevDefaultKey] = useState(`${classId}|${defaultMonth}`);
  const defaultKey = `${classId}|${defaultMonth}`;
  if (defaultKey !== prevDefaultKey) {
    setPrevDefaultKey(defaultKey);
    setSelectedMonth(defaultMonth);
  }

  // New tute form state
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newNote, setNewNote] = useState("");
  const [extraMonths, setExtraMonths] = useState<string[]>([]);

  // Attach existing catalog tute
  const [attachTuteId, setAttachTuteId] = useState("");

  // Edit catalog tute dialog
  const [editing, setEditing] = useState<ClassTuteCatalogItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");

  const [pending, startTransition] = useTransition();

  // Months that already have tutes scheduled for this class, with counts.
  const scheduledMonthsSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of scheduled) {
      counts.set(s.month, (counts.get(s.month) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [scheduled]);

  const monthOptions = useMemo(
    () =>
      buildPlanMonths(
        defaultMonth,
        scheduledMonthsSummary.map(([m]) => m),
      ),
    [defaultMonth, scheduledMonthsSummary],
  );

  // Quick upcoming future-month chips (+1, +2, +3, +4 months from selectedMonth).
  const upcomingMonthChoices = useMemo(
    () => [1, 2, 3, 4].map((d) => shiftMonth(selectedMonth, d)),
    [selectedMonth],
  );

  const monthTutes = useMemo(
    () => scheduled.filter((s) => s.month === selectedMonth).sort((a, b) => a.sortOrder - b.sortOrder),
    [scheduled, selectedMonth],
  );

  const attachedTuteIds = useMemo(() => new Set(monthTutes.map((t) => t.tuteId)), [monthTutes]);

  const attachableCatalog = useMemo(
    () => catalog.filter((t) => t.isActive && !attachedTuteIds.has(t.id)),
    [catalog, attachedTuteIds],
  );

  // Count how many months each catalog tute is scheduled in (for the catalog view).
  const monthCountByTuteId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of scheduled) {
      const list = map.get(s.tuteId) ?? [];
      list.push(s.month);
      map.set(s.tuteId, list);
    }
    return map;
  }, [scheduled]);

  const toggleExtraMonth = (m: string) => {
    setExtraMonths((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const targetMonths = [...new Set([selectedMonth, ...extraMonths.filter((m) => m !== selectedMonth)])];
    startTransition(async () => {
      const res = await createAndAssignClassTuteAction({
        batch_id: batchId,
        class_id: classId,
        name: newName.trim(),
        code: newCode.trim(),
        months: targetMonths,
        note: newNote.trim(),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setNewName("");
      setNewCode("");
      setNewNote("");
      setExtraMonths([]);
      router.refresh();
    });
  };

  const handleAttach = () => {
    if (!attachTuteId) return;
    startTransition(async () => {
      const res = await attachClassMonthTuteAction({
        class_id: classId,
        month: selectedMonth,
        tute_id: attachTuteId,
        note: "",
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setAttachTuteId("");
      router.refresh();
    });
  };

  const handleRemoveFromMonth = (linkId: string) => {
    startTransition(async () => {
      const res = await removeClassMonthTuteAction(linkId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  };

  const handleMove = (idx: number, delta: -1 | 1) => {
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= monthTutes.length) return;
    const ids = monthTutes.map((t) => t.id);
    [ids[idx], ids[targetIdx]] = [ids[targetIdx], ids[idx]];
    startTransition(async () => {
      const res = await reorderClassMonthTutesAction({
        class_id: classId,
        month: selectedMonth,
        ids,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  };

  const openEdit = (t: ClassTuteCatalogItem) => {
    setEditing(t);
    setEditName(t.name);
    setEditCode(t.code);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    startTransition(async () => {
      const res = await updateClassTuteAction({
        id: editing.id,
        name: editName.trim(),
        code: editCode.trim(),
        is_active: true,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setEditing(null);
      router.refresh();
    });
  };

  const handleDeleteCatalogTute = (id: string) => {
    startTransition(async () => {
      const res = await deleteClassTuteAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  };

  const isFutureMonth = selectedMonth > defaultMonth;

  return (
    <div className="space-y-4">
      {/* Month selector + scheduled months strip */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpenIcon className="size-4 text-primary" />
                Monthly &amp; Future Tutes — {className}
              </CardTitle>
              <CardDescription>
                Add different tutes for each month — including upcoming future months. Scheduled tutes automatically
                fill <code className="text-[11px]">{"{tutes}"}</code> and{" "}
                <code className="text-[11px]">{"{tutes_list}"}</code> in WhatsApp reminders and are ready for future
                Tute Dispatch.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="tute-month-select" className="text-xs whitespace-nowrap">
                Schedule month
              </Label>
              <Select
                value={selectedMonth}
                onValueChange={(m) => {
                  setSelectedMonth(m);
                  setExtraMonths([]);
                }}
              >
                <SelectTrigger id="tute-month-select" className="h-8 w-[175px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {monthLabel(m)}
                      {m === defaultMonth ? " (active)" : m > defaultMonth ? " (future)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        {scheduledMonthsSummary.length > 0 && (
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground mr-1 text-xs">Scheduled months:</span>
              {scheduledMonthsSummary.map(([m, count]) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={selectedMonth === m ? "default" : "outline"}
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => {
                    setSelectedMonth(m);
                    setExtraMonths([]);
                  }}
                >
                  {monthLabel(m, "short")}
                  <Badge
                    variant={selectedMonth === m ? "secondary" : "outline"}
                    className="px-1 text-[10px] tabular-nums"
                  >
                    {count}
                  </Badge>
                </Button>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        {/* Left: Scheduled tutes for the chosen month */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                {monthLabel(selectedMonth)} Tutes ({monthTutes.length})
                {isFutureMonth && <Badge variant="secondary">Future month</Badge>}
              </CardTitle>
            </div>
            <CardDescription>
              Order here controls the exact order shown in <code className="text-[11px]">{"{tutes_list}"}</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {monthTutes.length === 0 ? (
              <div className="bg-muted/35 rounded-xl border border-dashed p-6 text-center">
                <p className="text-sm font-medium">No tutes scheduled for {monthLabel(selectedMonth)} yet</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Add a new tute on the right or reuse an existing tute from the {batchName} catalog.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {monthTutes.map((item, idx) => {
                  const catalogItem = catalog.find((c) => c.id === item.tuteId);
                  return (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span aria-hidden="true">📘</span>
                          <span className="font-medium break-words">{item.tuteName}</span>
                          {item.tuteCode && (
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {item.tuteCode}
                            </Badge>
                          )}
                        </div>
                        {item.note && <p className="text-muted-foreground pl-6 text-xs">{item.note}</p>}
                      </div>

                      {canEdit && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Move ${item.tuteName} up`}
                            disabled={pending || idx === 0}
                            onClick={() => handleMove(idx, -1)}
                          >
                            <ArrowUpIcon className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Move ${item.tuteName} down`}
                            disabled={pending || idx === monthTutes.length - 1}
                            onClick={() => handleMove(idx, 1)}
                          >
                            <ArrowDownIcon className="size-3.5" />
                          </Button>
                          {catalogItem && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={`Rename ${item.tuteName}`}
                              disabled={pending}
                              onClick={() => openEdit(catalogItem)}
                            >
                              <PencilIcon className="size-3.5" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive size-7"
                            aria-label={`Remove ${item.tuteName} from ${monthLabel(selectedMonth)}`}
                            title={`Remove from ${monthLabel(selectedMonth)} (keeps in catalog)`}
                            disabled={pending}
                            onClick={() => handleRemoveFromMonth(item.id)}
                          >
                            <XIcon className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Live placeholder preview */}
            {monthTutes.length > 0 && (
              <div className="bg-muted/40 space-y-1.5 rounded-lg border p-3 text-xs">
                <p className="font-semibold">
                  How <code className="font-mono">{"{tutes_list}"}</code> renders in WhatsApp:
                </p>
                <pre className="font-sans leading-relaxed whitespace-pre-wrap">
                  {monthTutes.map((t) => `📘 ${t.tuteName}`).join("\n")}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Add new tute + Reuse from catalog */}
        {canEdit && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarPlusIcon className="size-4" /> Add new tute
                </CardTitle>
                <CardDescription>
                  Supports English &amp; Helakuru Sinhala. Assign to {monthLabel(selectedMonth)} and optionally future
                  months too.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tute-name">Tute name</Label>
                    <Input
                      id="tute-name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. Unit 07 - Database Systems / ඒකකය 07 නිබන්ධනය"
                      spellCheck={false}
                      maxLength={150}
                      required
                    />
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="tute-code">Short code (optional)</Label>
                      <Input
                        id="tute-code"
                        value={newCode}
                        onChange={(e) => setNewCode(e.target.value)}
                        placeholder="e.g. T-07, GR-U04"
                        maxLength={30}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tute-note">Note (optional)</Label>
                      <Input
                        id="tute-note"
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="e.g. Part 1, Speed Post"
                        maxLength={200}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">
                      Also add to future months (optional):
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="default" className="py-1 text-xs">
                        {monthLabel(selectedMonth, "short")} ✓
                      </Badge>
                      {upcomingMonthChoices.map((m) => {
                        const checked = extraMonths.includes(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => toggleExtraMonth(m)}
                            className={cn(
                              "rounded-md border px-2 py-0.5 text-xs transition-colors",
                              checked
                                ? "border-primary bg-primary/10 text-primary font-medium"
                                : "bg-muted/50 hover:bg-accent text-muted-foreground",
                            )}
                          >
                            {checked ? `+ ${monthLabel(m, "short")} ✓` : `+ ${monthLabel(m, "short")}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <Button type="submit" size="sm" className="w-full" disabled={pending || newName.trim().length < 2}>
                    {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
                    Add to {monthLabel(selectedMonth, "short")}
                    {extraMonths.length > 0 ? ` + ${extraMonths.length} future month${extraMonths.length === 1 ? "" : "s"}` : ""}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {attachableCatalog.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Link2Icon className="size-4" /> Reuse existing tute ({batchName})
                  </CardTitle>
                  <CardDescription>
                    Attach a tute already in this batch&apos;s catalog to {monthLabel(selectedMonth)} without re-typing.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Select value={attachTuteId} onValueChange={setAttachTuteId}>
                    <SelectTrigger className="h-8 min-w-[200px] flex-1 text-xs">
                      <SelectValue placeholder="Choose from catalog..." />
                    </SelectTrigger>
                    <SelectContent>
                      {attachableCatalog.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.code ? `[${t.code}] ` : ""}
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="outline" disabled={pending || !attachTuteId} onClick={handleAttach}>
                    Attach
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Batch Tute Catalog (ready for future Tute Dispatch) */}
      {catalog.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {batchName} Tute Catalog ({catalog.length})
            </CardTitle>
            <CardDescription>
              Shared catalog for this batch — reusable across months, classes, and future Tute Dispatch rounds.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.map((t) => {
                const usedMonths = monthCountByTuteId.get(t.id) ?? [];
                return (
                  <div
                    key={t.id}
                    className="flex items-start justify-between gap-2 rounded-lg border p-2.5 text-sm"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium break-words">
                        {t.name}{" "}
                        {t.code && (
                          <Badge variant="outline" className="ml-1 font-mono text-[10px]">
                            {t.code}
                          </Badge>
                        )}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {usedMonths.length > 0
                          ? `In ${className}: ${usedMonths.map((m) => monthLabel(m, "short")).join(", ")}`
                          : `Not scheduled in ${className} yet`}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Edit ${t.name}`}
                          onClick={() => openEdit(t)}
                        >
                          <PencilIcon className="size-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive size-7"
                              aria-label={`Delete ${t.name}`}
                            >
                              <Trash2Icon className="size-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete &ldquo;{t.name}&rdquo; from catalog?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes the tute from the catalog and unlinks it from all scheduled months.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteCatalogTute(t.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete tute
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Catalog Tute Dialog */}
      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit tute</DialogTitle>
            <DialogDescription>Renaming updates this tute across every month it is scheduled in.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-tute-name">Tute name</Label>
              <Input
                id="edit-tute-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                spellCheck={false}
                maxLength={150}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-tute-code">Short code (optional)</Label>
              <Input
                id="edit-tute-code"
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
                maxLength={30}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || editName.trim().length < 2}>
                {pending && <Loader2Icon className="animate-spin" />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
