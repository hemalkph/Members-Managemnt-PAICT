"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignClassTutesAction } from "@/lib/actions/class-ops";
import type { ClassRow, PlannedTute, ShelfTute } from "@/lib/class-ops/queries";
import type { ActionResult } from "@/lib/core/action-result";
import { monthLabel } from "@/lib/core/month";

type Group = { batchId: string; batchName: string; classes: ClassRow[] };

/** Pick tutes and classes (from any batch) and schedule every pair for one month. */
export function AddTutesDialog({
  months,
  groups,
  tutes,
  plan,
  pending,
  run,
  onClose,
}: {
  months: string[];
  groups: Group[];
  tutes: ShelfTute[];
  plan: PlannedTute[];
  pending: boolean;
  run: (fn: () => Promise<ActionResult>) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(months[0]);
  const [tuteIds, setTuteIds] = useState<string[]>([]);
  const [classIds, setClassIds] = useState<string[]>([]);
  const allClassIds = groups.flatMap((g) => g.classes.map((c) => c.class_id));

  const toggle = (list: string[], ids: string[], on: boolean) =>
    on ? [...new Set([...list, ...ids])] : list.filter((x) => !ids.includes(x));
  const state = (ids: string[], picked: string[]) =>
    ids.every((id) => picked.includes(id)) ? true : ids.some((id) => picked.includes(id)) ? "indeterminate" : false;

  const planned = new Set(plan.filter((p) => p.month === month).map((p) => `${p.classId}:${p.tuteId}`));
  const newPairs = classIds.reduce((n, c) => n + tuteIds.filter((t) => !planned.has(`${c}:${t}`)).length, 0);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add tutes to classes</DialogTitle>
          <DialogDescription>
            Pick the tutes and every class that gets them, in any batch. Tute stock adds up the copies.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
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
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm font-medium">Tutes</legend>
              {tutes.length === 0 ? (
                <p className="text-muted-foreground text-xs">No tutes on the shelf yet. Add them on Tute stock.</p>
              ) : (
                <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {tutes.map((t) => (
                    <label key={t.id} className="hover:bg-muted/50 flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-sm">
                      <Checkbox
                        className="mt-0.5"
                        checked={tuteIds.includes(t.id)}
                        onCheckedChange={(v) => setTuteIds((l) => toggle(l, [t.id], v === true))}
                      />
                      <span className="min-w-0">
                        <span className="block leading-snug break-words">{t.name}</span>
                        {t.code && <span className="text-muted-foreground font-mono text-xs">{t.code}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm font-medium">Classes</legend>
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border p-2">
                <label className="flex cursor-pointer items-center gap-2 px-1.5 py-1 text-sm font-medium">
                  <Checkbox
                    checked={state(allClassIds, classIds)}
                    onCheckedChange={(v) => setClassIds((l) => toggle(l, allClassIds, v === true))}
                  />
                  All classes
                </label>
                {groups.map((g) => {
                  const ids = g.classes.map((c) => c.class_id);
                  return (
                    <div key={g.batchId} className="space-y-0.5">
                      <label className="text-muted-foreground flex cursor-pointer items-center gap-2 px-1.5 py-0.5 text-xs font-semibold">
                        <Checkbox
                          checked={state(ids, classIds)}
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
                          {c.name}
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={pending || newPairs === 0}>
              {newPairs > 0 ? `Schedule ${newPairs}` : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
