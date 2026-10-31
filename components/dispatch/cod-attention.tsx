"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { writeOffAction } from "@/lib/actions/dispatch-money";
import { COD_STATUS, type CodStatus } from "@/lib/dispatch/money";
import { formatLKR } from "@/lib/format";

export type CodRow = {
  parcelId: string;
  roundName: string;
  reference: string;
  trackingNo: string | null;
  due: number;
  paid: number;
  writtenOff: number;
  outstanding: number;
  status: CodStatus;
};

/** Parcels whose money needs a look: unpaid, part paid, paid too much or in a draft. */
export function CodAttention({ rows }: { rows: CodRow[] }) {
  const router = useRouter();
  const [w, setW] = useState<{ row: CodRow; amount: string; reason: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      if (!w) return;
      const r = await writeOffAction({ parcel_id: w.row.parcelId, amount: Number(w.amount || 0), reason: w.reason });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setW(null);
      router.refresh();
    });

  if (rows.length === 0) return <p className="text-muted-foreground text-sm">Nothing needs attention – every delivered parcel is settled.</p>;

  return (
    <>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Parcel</TableHead>
              <TableHead className="hidden md:table-cell">Round</TableHead>
              <TableHead className="hidden sm:table-cell">Due</TableHead>
              <TableHead className="hidden sm:table-cell">Paid</TableHead>
              <TableHead>Owed</TableHead>
              <TableHead className="pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.parcelId}>
                <TableCell className="pl-4">
                  <span className="font-mono text-sm">{r.reference}</span>
                  <span className="mt-0.5 block">
                    <Badge variant={COD_STATUS[r.status].variant}>{COD_STATUS[r.status].label}</Badge>
                  </span>
                </TableCell>
                <TableCell className="hidden max-w-48 truncate text-sm md:table-cell">{r.roundName}</TableCell>
                <TableCell className="hidden text-sm tabular-nums sm:table-cell">{formatLKR(r.due)}</TableCell>
                <TableCell className="hidden text-sm tabular-nums sm:table-cell">{formatLKR(r.paid)}</TableCell>
                <TableCell className="text-sm font-medium tabular-nums">{formatLKR(r.outstanding)}</TableCell>
                <TableCell className="pr-4 text-right">
                  {(r.status === "part_paid" || r.status === "unpaid") && (
                    <Button size="sm" variant="ghost" onClick={() => setW({ row: r, amount: String(r.outstanding), reason: "" })}>
                      Write off…
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={w !== null} onOpenChange={(o) => !o && setW(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Write off the shortfall on {w?.row.reference}?</DialogTitle>
            <DialogDescription>Use this when the money won&apos;t come (for example the student paid less). It is recorded with your name.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="wo-amount">Amount (Rs.)</Label>
              <Input id="wo-amount" inputMode="decimal" value={w?.amount ?? ""} onChange={(e) => w && setW({ ...w, amount: e.target.value.replace(/[^\d.]/g, "") })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wo-reason">Reason</Label>
              <Input id="wo-reason" value={w?.reason ?? ""} onChange={(e) => w && setW({ ...w, reason: e.target.value })} maxLength={300} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setW(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending || !w || Number(w.amount) <= 0 || w.reason.trim().length < 3}>
              Write off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
