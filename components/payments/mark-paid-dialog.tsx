"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BadgeCheckIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
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
import { markPaidAction } from "@/lib/actions/payments";
import { formatLKR } from "@/lib/format";
import type { PayoutRow } from "./payouts-table";

export function MarkPaidDialog({
  rows,
  today,
  open,
  onOpenChange,
  onDone,
}: {
  rows: PayoutRow[];
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState("");
  const [pending, startTransition] = useTransition();

  const total = rows.reduce((s, r) => s + r.total, 0);
  const missingBank = rows.filter((r) => !r.bankName && r.total > 0).length;
  const single = rows.length === 1 ? rows[0] : null;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await markPaidAction({ ids: rows.map((r) => r.id), paid: true, paid_on: paidOn, reference });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setReference("");
      onDone();
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPaidOn(today);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{single ? `Mark ${single.name} as paid` : `Mark ${rows.length} members as paid`}</DialogTitle>
          <DialogDescription>
            {formatLKR(total)} in total. Members see the date and reference on their payslip.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="paid-on">Date paid</Label>
              <Input
                id="paid-on"
                type="date"
                value={paidOn}
                max={today}
                required
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="paid-ref">Reference (optional)</Label>
              <Input
                id="paid-ref"
                value={reference}
                maxLength={100}
                placeholder="e.g. BOC transfer 4581"
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>
          {missingBank > 0 && (
            <p className="text-sm text-amber-700 dark:text-warning">
              {missingBank} of these member{missingBank === 1 ? " has" : "s have"} no bank details. Only mark them as paid
              if you paid another way (e.g. cash).
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="success" disabled={pending || rows.length === 0 || !paidOn}>
              {pending ? <Loader2Icon className="animate-spin" /> : <BadgeCheckIcon />}
              Mark as paid
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
