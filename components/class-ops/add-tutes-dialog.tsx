"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckIcon, Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import { BookletEmblem } from "@/components/tutes/booklet-emblem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignClassTutesAction } from "@/lib/actions/class-ops";
import type { ClassRow, PlannedTute, ShelfTute } from "@/lib/class-ops/queries";
import type { ActionResult } from "@/lib/core/action-result";
import { monthLabel } from "@/lib/core/month";
import { cn } from "@/lib/utils";

type Group = { batchId: string; batchName: string; classes: ClassRow[] };

/** Pick tutes and classes (from any batch) and schedule every new pair for one month. */
export function AddTutesDialog({
  months,
  groups,
  tutes,
  coverUrls,
  plan,
  initialMonth,
  initialClassId,
  pending,
  run,
  onClose,
}: {
  months: string[];
  groups: Group[];
  tutes: ShelfTute[];
  coverUrls: Record<string, string>;
  plan: PlannedTute[];
  initialMonth?: string;
  initialClassId?: string;
  pending: boolean;
  run: (fn: () => Promise<ActionResult<unknown>>) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(() => (initialMonth && months.includes(initialMonth) ? initialMonth : months[0]));
  const [tuteIds, setTuteIds] = useState<string[]>([]);
  const [classIds, setClassIds] = useState<string[]>(() => (initialClassId ? [initialClassId] : []));
  const [tuteSearch, setTuteSearch] = useState("");
  const allClassIds = groups.flatMap((g) => g.classes.map((c) => c.class_id));

  const toggle = (list: string[], ids: string[], on: boolean) =>
    on ? [...new Set([...list, ...ids])] : list.filter((x) => !ids.includes(x));
  const checkState = (ids: string[], picked: string[]) =>
    ids.length > 0 && ids.every((id) => picked.includes(id))
      ? true
      : ids.some((id) => picked.includes(id))
        ? "indeterminate"
        : false;

  const planned = useMemo(
    () => new Set(plan.filter((p) => p.month === month).map((p) => `${p.classId}:${p.tuteId}`)),
    [plan, month],
  );

  const visibleTutes = useMemo(() => {
    const q = tuteSearch.trim().toLowerCase();
    if (!q) return tutes;
    return tutes.filter((t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q));
  }, [tutes, tuteSearch]);

  const newPairs = classIds.reduce((n, c) => n + tuteIds.filter((t) => !planned.has(`${c}:${t}`)).length, 0);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add tutes to classes</DialogTitle>
          <DialogDescription>
            Pick the tutes and every class that gets them, in any batch. Already-scheduled pairs are skipped cleanly.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (newPairs === 0) return;
            run(() => assignClassTutesAction({ month, class_ids: classIds, tute_ids: tuteIds }));
          }}
        >
          <div className="grid gap-1.5">
            <Label>Month</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger aria-label="Month" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {monthLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Tutes list with live search, cover thumbnails, and Scheduled badges */}
            <fieldset className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <legend className="text-sm font-medium">
                  Tutes{" "}
                  {tuteIds.length > 0 && (
                    <span className="text-muted-foreground text-xs font-normal tabular-nums">({tuteIds.length})</span>
                  )}
                </legend>
                {tutes.length > 0 && (
                  <Link href="/admin/tutes" className="text-primary text-xs hover:underline">
                    Manage shelf
                  </Link>
                )}
              </div>

              {tutes.length > 5 && (
                <InputGroup className="h-8">
                  <InputGroupAddon align="inline-start">
                    <SearchIcon className="size-3.5" />
                  </InputGroupAddon>
                  <InputGroupInput
                    value={tuteSearch}
                    onChange={(e) => setTuteSearch(e.target.value)}
                    placeholder="Filter tutes…"
                    aria-label="Filter tutes"
                    className="h-8 text-xs"
                  />
                  {tuteSearch && (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton size="icon-xs" aria-label="Clear filter" onClick={() => setTuteSearch("")}>
                        <XIcon className="size-3" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  )}
                </InputGroup>
              )}

              {tutes.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No tutes on the shelf yet.{" "}
                  <Link href="/admin/tutes" className="text-primary underline">
                    Add them on Tute stock
                  </Link>
                  .
                </p>
              ) : visibleTutes.length === 0 ? (
                <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs">
                  No tutes match &ldquo;{tuteSearch}&rdquo;.
                </div>
              ) : (
                <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {visibleTutes.map((t) => {
                    const scheduledCount = classIds.filter((c) => planned.has(`${c}:${t.id}`)).length;
                    const alreadyAll = classIds.length > 0 && scheduledCount === classIds.length;
                    const alreadySome = scheduledCount > 0 && !alreadyAll;
                    const checked = tuteIds.includes(t.id);

                    return (
                      <label
                        key={t.id}
                        className={cn(
                          "hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm transition-colors",
                          alreadyAll && "opacity-65",
                        )}
                      >
                        <Checkbox
                          checked={alreadyAll ? true : checked}
                          disabled={alreadyAll}
                          onCheckedChange={(v) => setTuteIds((l) => toggle(l, [t.id], v === true))}
                        />
                        <BookletEmblem
                          name={t.name}
                          code={t.code}
                          coverUrl={coverUrls[t.id] ?? null}
                          className="h-9 w-7 text-[8px]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs leading-snug font-medium break-words">{t.name}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            {t.code && <span className="text-muted-foreground font-mono text-[11px]">{t.code}</span>}
                            {alreadyAll && (
                              <Badge variant="secondary" className="h-4 gap-0.5 px-1.5 text-[10px]">
                                <CheckIcon className="size-2.5" /> Scheduled
                              </Badge>
                            )}
                            {alreadySome && (
                              <Badge variant="outline" className="h-4 px-1.5 text-[10px] tabular-nums">
                                {scheduledCount}/{classIds.length} scheduled
                              </Badge>
                            )}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>

            {/* Classes picker */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Classes{" "}
                {classIds.length > 0 && (
                  <span className="text-muted-foreground text-xs font-normal tabular-nums">({classIds.length})</span>
                )}
              </legend>
              <div className="max-h-[328px] space-y-2 overflow-y-auto rounded-lg border p-2">
                <label className="flex cursor-pointer items-center gap-2 px-1.5 py-1 text-sm font-medium">
                  <Checkbox
                    checked={checkState(allClassIds, classIds)}
                    onCheckedChange={(v) => setClassIds((l) => toggle(l, allClassIds, v === true))}
                  />
                  All active classes
                </label>
                {groups.map((g) => {
                  const ids = g.classes.map((c) => c.class_id);
                  return (
                    <div key={g.batchId} className="space-y-0.5">
                      <label className="text-muted-foreground flex cursor-pointer items-center gap-2 px-1.5 py-0.5 text-xs font-semibold">
                        <Checkbox
                          checked={checkState(ids, classIds)}
                          onCheckedChange={(v) => setClassIds((l) => toggle(l, ids, v === true))}
                        />
                        {g.batchName}
                      </label>
                      {g.classes.map((c) => (
                        <label
                          key={c.class_id}
                          className="hover:bg-muted/50 ml-5 flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm"
                        >
                          <Checkbox
                            checked={classIds.includes(c.class_id)}
                            onCheckedChange={(v) => setClassIds((l) => toggle(l, [c.class_id], v === true))}
                          />
                          <span className="min-w-0 truncate">{c.name}</span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Close
            </Button>
            <Button type="submit" disabled={pending || newPairs === 0}>
              {pending && <Loader2Icon className="animate-spin" />}
              {newPairs > 0 ? `Schedule ${newPairs}` : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
