"use client";

import { useState } from "react";
import { CheckCircle2Icon, MessageCircleIcon, PhoneOffIcon, SkipForwardIcon } from "lucide-react";
import { WhatsAppPreview } from "@/components/fees/whatsapp-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSiteUrl } from "@/lib/core/env";
import { formatLKR } from "@/lib/core/format";
import { receiptWhatsAppText } from "@/lib/payments/receipt";
import { whatsAppLink } from "@/lib/tasks/whatsapp";
import type { PayoutRow } from "./payouts-table";

export type PaidInfo = { paidOn: string; reference: string | null };

/** The receipt message for a row. `paid` overrides the row's own date and reference (just submitted). */
export function receiptText(row: PayoutRow, paid: PaidInfo | null): string {
  return receiptWhatsAppText(
    {
      memberName: row.name,
      monthKey: row.monthKey,
      payslipNo: row.payslipNo,
      salary: row.salary,
      work: row.work,
      items: row.items,
      total: row.total,
      paidOn: paid?.paidOn ?? row.paidOn ?? "",
      reference: paid ? paid.reference : row.reference,
      token: row.receiptToken,
    },
    getSiteUrl(),
  );
}

/** WhatsApp link with the receipt filled in, or null when the member has no number. */
export function receiptHref(row: PayoutRow, paid: PaidInfo | null): string | null {
  return row.waPhone ? whatsAppLink(row.waPhone, receiptText(row, paid)) : null;
}

/** After "Mark as paid": one member at a time, open WhatsApp with their receipt, or skip. */
export function ReceiptQueueDialog({
  rows,
  paid,
  open,
  onOpenChange,
}: {
  rows: PayoutRow[];
  paid: PaidInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [opened, setOpened] = useState(0);

  const close = (next: boolean) => {
    if (!next) {
      setIndex(0);
      setOpened(0);
    }
    onOpenChange(next);
  };

  const row = rows[index];
  const done = index >= rows.length;
  const href = row ? receiptHref(row, paid) : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{done ? "Receipts done" : "Send receipts on WhatsApp"}</DialogTitle>
          <DialogDescription>
            {done
              ? `${opened} opened, ${rows.length - opened} skipped.`
              : `${index + 1} of ${rows.length} · press send in WhatsApp, then come back for the next.`}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex justify-center py-4">
            <CheckCircle2Icon className="text-success size-10" aria-hidden />
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-medium">{row.name}</p>
              <span className="font-semibold tabular-nums">{formatLKR(row.total)}</span>
            </div>
            {href ? (
              <WhatsAppPreview text={receiptText(row, paid)} className="max-h-72 overflow-y-auto" />
            ) : (
              <Badge variant="warning" className="w-fit">
                <PhoneOffIcon /> No number
              </Badge>
            )}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={() => close(false)}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setIndex((i) => i + 1)}>
                <SkipForwardIcon /> Skip
              </Button>
              {href && (
                <Button asChild variant="success">
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      setOpened((n) => n + 1);
                      setIndex((i) => i + 1);
                    }}
                  >
                    <MessageCircleIcon /> Open WhatsApp
                  </a>
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
