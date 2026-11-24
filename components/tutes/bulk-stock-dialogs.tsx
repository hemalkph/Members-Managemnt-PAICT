"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { countTutesAction, handOutTutesAction } from "@/lib/actions/tutes";
import type { ActionResult } from "@/lib/core/action-result";
import { monthLabel } from "@/lib/core/month";
import type { TuteClassNeed, TuteStockRow } from "@/lib/supabase/database.types";

/** Hall copies still left to hand out for a class (excludes Online students who go by Speed Post). */
export function hallRemaining(c: TuteClassNeed): number {
  if (c.online > 0) {
    const hallExpected = Math.max(c.expected - c.online, 0);
    const hallGiven = c.hall_given ?? 0;
    return Math.max(hallExpected - hallGiven, 0);
  }
  return Math.max(c.expected - c.given, 0);
}

type Run = (fn: () => Promise<ActionResult>) => void;

const whole = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  return t === "" ? null : Number(t);
};

/** Count every tute on the shelf in one go. Blank boxes are skipped. */
export function CountAllDialog({
  rows,
  pending,
  run,
  onClose,
}: {
  rows: TuteStockRow[];
  pending: boolean;
  run: Run;
  onClose: () => void;
}) {
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const entries = rows
      .map((r) => ({ tute_id: r.tute_id, counted: whole(f.get(r.tute_id)) }))
      .filter((c): c is { tute_id: string; counted: number } => c.counted !== null);
    run(() => countTutesAction(entries));
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Count all tutes</DialogTitle>
          <DialogDescription>
            Type the copies on the shelf for each tute. Leave a box blank to skip it. A tute&apos;s first count is its
            opening stock; later counts save the difference.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="divide-y rounded-lg border">
            {rows.map((r) => (
              <div key={r.tute_id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <Label htmlFor={`count-${r.tute_id}`} className="block leading-snug font-medium break-words">
                    {r.name}
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    {r.code && <span className="mr-1.5 font-mono">{r.code}</span>}
                    {r.status === "not_counted" ? "Not counted yet" : `Record: ${r.on_hand}`}
                  </p>
                </div>
                <Input
                  id={`count-${r.tute_id}`}
                  name={r.tute_id}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100000}
                  step={1}
                  className="h-8 w-24 text-right tabular-nums"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={pending}>
              Save counts
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Give one class its copies of every tute scheduled for it this month. */
export function HandOutDialog({
  rows,
  reserved,
  month,
  pending,
  run,
  onClose,
}: {
  rows: TuteStockRow[];
  reserved: Record<string, number>;
  month: string;
  pending: boolean;
  run: Run;
  onClose: () => void;
}) {
  const classes = useMemo(() => {
    const map = new Map<string, { id: string; name: string; batch: string; left: number }>();
    for (const r of rows) {
      for (const c of r.classes) {
        const cur = map.get(c.id) ?? { id: c.id, name: c.name, batch: c.batch ?? "", left: 0 };
        cur.left += hallRemaining(c);
        map.set(c.id, cur);
      }
    }
    return [...map.values()].sort((a, b) => a.batch.localeCompare(b.batch) || a.name.localeCompare(b.name));
  }, [rows]);
  const [classId, setClassId] = useState(() => (classes.find((c) => c.left > 0) ?? classes[0])?.id ?? "");

  const items = rows.flatMap((r) => {
    const c = r.classes.find((x) => x.id === classId);
    if (!c) return [];
    const free = Math.max(r.on_hand - (reserved[r.tute_id] ?? 0), 0);
    const left = hallRemaining(c);
    return [{ row: r, left, free, suggested: Math.min(left, free) }];
  });

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const picked = items
      .map((it) => ({ tute_id: it.row.tute_id, qty: whole(f.get(it.row.tute_id)) ?? 0 }))
      .filter((it) => it.qty > 0);
    run(() => handOutTutesAction({ class_id: classId, month, items: picked }));
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hand out to a class</DialogTitle>
          <DialogDescription>
            Every tute scheduled for the class in {monthLabel(month)}, filled in with the Hall copies still to give
            (Online students get theirs by Speed Post). Change any number, or set it to 0 to skip.
          </DialogDescription>
        </DialogHeader>
        {classes.length === 0 ? (
          <>
            <p className="text-muted-foreground text-sm">
              No tutes are scheduled for a class in {monthLabel(month)}. Plan them on Classes → Tute plan first.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-2">
              <Label>Class</Label>
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger aria-label="Class" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      <span className="text-muted-foreground ml-1 tabular-nums">
                        {c.batch && `· ${c.batch} `}· {c.left} to give
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div key={classId} className="divide-y rounded-lg border">
              {items.map(({ row, left, free, suggested }) => (
                <div key={row.tute_id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <Label htmlFor={`give-${row.tute_id}`} className="block leading-snug font-medium break-words">
                      {row.name}
                    </Label>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {left} still to give · {free} free on the shelf
                      {free < left && (
                        <Badge variant="warning" className="ml-1.5 text-[10px]">
                          Short {left - free}
                        </Badge>
                      )}
                    </p>
                  </div>
                  <Input
                    id={`give-${row.tute_id}`}
                    name={row.tute_id}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100000}
                    step={1}
                    defaultValue={suggested || ""}
                    placeholder="0"
                    className="h-8 w-24 text-right tabular-nums"
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button type="submit" disabled={pending}>
                Give out
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
