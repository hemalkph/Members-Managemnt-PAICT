"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
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
import { setClassFeeAction } from "@/lib/actions/money";
import { formatLKR } from "@/lib/core/format";
import { dateToMonthKey, monthLabel, shiftMonth } from "@/lib/core/month";
import type { ClassFeeRow } from "@/lib/money/build";

/** Every class with its monthly fee; main admins set or change it from a month. */
export function ClassFeesCard({ fees, thisMonth }: { fees: ClassFeeRow[]; thisMonth: string }) {
  const [editing, setEditing] = useState<ClassFeeRow | null>(null);
  const shown = fees.filter((f) => f.isActive || f.fee !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Class fees</CardTitle>
        <CardDescription>One monthly fee per class. A change applies from the month you pick.</CardDescription>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="text-muted-foreground text-sm">No classes yet. Add them on the Classes page.</p>
        ) : (
          <ul className="divide-y">
            {shown.map((f) => (
              <li key={f.classId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{f.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {f.batch}
                    {!f.isActive && " · not in use"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    {f.fee === null ? (
                      <p className="text-xs font-medium text-amber-700 dark:text-warning">No fee yet</p>
                    ) : (
                      <>
                        <p className="text-sm font-semibold tabular-nums">{formatLKR(f.fee)}</p>
                        {f.fromMonth && (
                          <p className="text-muted-foreground text-xs">
                            from {monthLabel(dateToMonthKey(f.fromMonth), "short")}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Edit the fee for ${f.name}`} onClick={() => setEditing(f)}>
                    <PencilIcon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {editing && <FeeDialog row={editing} thisMonth={thisMonth} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function FeeDialog({ row, thisMonth, onClose }: { row: ClassFeeRow; thisMonth: string; onClose: () => void }) {
  const router = useRouter();
  const [fee, setFee] = useState(row.fee === null ? "" : String(row.fee));
  const [from, setFrom] = useState(thisMonth);
  const [pending, startTransition] = useTransition();
  // 12 months back (to correct older income) up to 3 ahead (a planned change).
  const options = Array.from({ length: 16 }, (_, i) => shiftMonth(thisMonth, 3 - i));

  const save = () =>
    startTransition(async () => {
      const res = await setClassFeeAction({ class_id: row.classId, from_month: from, fee });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Fee for {row.name}</DialogTitle>
          <DialogDescription>Months before the one you pick keep their old fee.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="class-fee">Monthly fee (Rs.)</Label>
            <Input
              id="class-fee"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fee.trim() && save()}
              placeholder="e.g. 2500"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="class-fee-from">From</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger id="class-fee-from" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((m) => (
                  <SelectItem key={m} value={m}>
                    {monthLabel(m)}
                    {m === thisMonth ? " (this month)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !fee.trim()}>
            {pending && <Loader2Icon className="animate-spin" />}
            Save fee
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
