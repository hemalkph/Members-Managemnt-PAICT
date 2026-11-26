import type { Metadata } from "next";
import { BadgeCheckIcon, ReceiptTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PAYSLIP_ORGANISATION } from "@/lib/core/config";
import { formatDateNumeric, formatLKR } from "@/lib/core/format";
import { dateToMonthKey, monthLabel } from "@/lib/core/month";
import { isReceiptToken } from "@/lib/payments/receipt";
import { createClient } from "@/lib/supabase/server";

// Never reads the database, so the preview never shows a name or amount.
export const metadata: Metadata = {
  title: "Salary receipt",
  description: PAYSLIP_ORGANISATION,
  robots: { index: false, follow: false },
};

export default async function ReceiptPage({ params }: PageProps<"/receipt/[token]">) {
  const { token } = await params;
  const receipt = isReceiptToken(token)
    ? (await (await createClient()).rpc("payout_receipt", { p_token: token }).maybeSingle()).data
    : null;

  if (!receipt) {
    return (
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <ReceiptTextIcon className="text-muted-foreground mx-auto size-8" aria-hidden />
          <CardTitle>This receipt is no longer valid</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Ask the PA ICT team to send it again.
        </CardContent>
      </Card>
    );
  }

  const salary = Number(receipt.salary_amount);
  const work = Number(receipt.work_amount);
  const items = receipt.approved_items;

  return (
    <Card className="w-full max-w-sm gap-4">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Salary receipt</CardTitle>
          <Badge variant="success">
            <BadgeCheckIcon /> Paid
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {receipt.first_name} · {monthLabel(dateToMonthKey(receipt.month))}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-2 text-sm">
          {salary > 0 && <Row label="Salary" value={formatLKR(salary)} />}
          {work > 0 && <Row label={`Work (${items} item${items === 1 ? "" : "s"})`} value={formatLKR(work)} />}
          <div className="flex items-baseline justify-between gap-4 border-t pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatLKR(Number(receipt.total_amount))}</dd>
          </div>
        </dl>
        <dl className="text-muted-foreground space-y-1 text-xs">
          {receipt.payment_reference && <Row label="Reference" value={receipt.payment_reference} />}
          <Row label="Paid on" value={formatDateNumeric(receipt.paid_on)} />
          <Row label="Payslip No." value={receipt.payslip_no} mono />
        </dl>
        <p className="text-muted-foreground border-t pt-3 text-center text-xs">{PAYSLIP_ORGANISATION}</p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt>{label}</dt>
      <dd className={mono ? "font-mono" : "tabular-nums"}>{value}</dd>
    </div>
  );
}
