"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordPaymentAction } from "@/lib/actions/students";
import { formatLKR } from "@/lib/core/format";
import { monthLabel } from "@/lib/core/month";
import { cn } from "@/lib/utils";

type Month = { month: string; payment: "paid" | "unpaid" | null; amount: number | null };
type Editing = { month: string; status: "paid" | "unpaid"; amount: string; paidOn: string; note: string };

/**
 * Half and Paid card payments, one row per month (newest first). Months
 * before the student was verified are shown but not expected.
 */
export function Payments({
  studentId,
  months,
  verifiedMonth,
  monthlyAmount,
  today,
  canEdit,
}: {
  studentId: string;
  months: Month[];
  verifiedMonth: string | null;
  monthlyAmount: number | null;
  today: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (status: "paid" | "unpaid" | null, e?: Editing) =>
    startTransition(async () => {
      const result = await recordPaymentAction({
        student_id: studentId,
        month: e?.month ?? editing!.month,
        status,
        amount: status === "paid" ? (e?.amount ?? "") : "",
        paid_on: status === "paid" ? (e?.paidOn ?? "") : "",
        note: e?.note ?? "",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setEditing(null);
      router.refresh();
    });

  const open = (m: Month) =>
    setEditing({
      month: m.month,
      status: m.payment ?? "paid",
      amount: m.amount !== null ? String(m.amount) : monthlyAmount !== null ? String(monthlyAmount) : "",
      paidOn: today,
      note: "",
    });

  return (
    <>
      <ul className="divide-y rounded-lg border">
        {months.map((m) => {
          const expected = verifiedMonth !== null && m.month >= verifiedMonth;
          const late = expected && m.payment !== "paid" && m.month < today.slice(0, 7);
          return (
            <li key={m.month} className={cn("flex items-center gap-3 px-3 py-2 text-sm", late && "bg-destructive/5")}>
              <span className="w-32 shrink-0">{monthLabel(m.month)}</span>
              <span className="min-w-0 flex-1">
                {m.payment === "paid" ? (
                  <Badge variant="success">Paid {m.amount !== null && formatLKR(m.amount)}</Badge>
                ) : m.payment === "unpaid" ? (
                  <Badge variant="destructive">Unpaid</Badge>
                ) : expected ? (
                  <span className="text-muted-foreground">Not recorded</span>
                ) : (
                  <span className="text-muted-foreground text-xs">Before verifying</span>
                )}
              </span>
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => open(m)}>
                  {m.payment ? "Change" : "Record"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          {editing && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                run(editing.status, editing);
              }}
            >
              <DialogHeader>
                <DialogTitle>{monthLabel(editing.month)}</DialogTitle>
                <DialogDescription>Each payment change goes to the activity log.</DialogDescription>
              </DialogHeader>
              <div className="inline-flex w-fit rounded-md border" role="radiogroup" aria-label="Payment status">
                {(["paid", "unpaid"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={editing.status === s}
                    onClick={() => setEditing({ ...editing, status: s })}
                    className={cn(
                      "px-4 py-1.5 text-sm font-medium first:rounded-l-md last:rounded-r-md",
                      editing.status === s
                        ? s === "paid"
                          ? "bg-success text-white"
                          : "bg-destructive text-white"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {s === "paid" ? "Paid" : "Unpaid"}
                  </button>
                ))}
              </div>
              {editing.status === "paid" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="pay-amount">Amount (Rs.)</Label>
                    <Input
                      id="pay-amount"
                      inputMode="decimal"
                      value={editing.amount}
                      onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="pay-date">Paid on</Label>
                    <Input id="pay-date" type="date" value={editing.paidOn} onChange={(e) => setEditing({ ...editing, paidOn: e.target.value })} />
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="pay-note">Note (optional)</Label>
                <Input id="pay-note" maxLength={300} value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
              </div>
              <DialogFooter className="sm:justify-between">
                {months.find((m) => m.month === editing.month)?.payment ? (
                  <Button type="button" variant="ghost" className="text-destructive" disabled={pending} onClick={() => run(null)}>
                    Clear
                  </Button>
                ) : (
                  <span />
                )}
                <SubmitButton pending={pending} disabled={editing.status === "paid" && !editing.amount.trim()}>
                  Save
                </SubmitButton>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
