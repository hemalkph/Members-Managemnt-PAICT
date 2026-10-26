import { BadgeCheckIcon, CircleDashedIcon } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import GradientText from "@/components/reactbits/gradient-text";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAYSLIP_ORGANISATION } from "@/lib/config";
import { formatDate, formatDateTime, formatLKR, formatNumber, maskAccountNumber } from "@/lib/format";
import { monthLabel } from "@/lib/month";
import { workLineLabel, type Payslip } from "@/lib/payslip";

function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={mono ? "truncate font-mono text-sm" : "truncate text-sm font-medium"}>{value || "—"}</dd>
    </div>
  );
}

export function PayslipView({ slip }: { slip: Payslip }) {
  const p = slip.payout;
  const paid = p.status === "paid";

  return (
    <Card className="overflow-hidden py-0">
      {/* Header band */}
      <div className="from-primary/12 via-primary/5 to-transparent flex flex-col gap-4 border-b bg-gradient-to-br p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-3">
          <BrandLogo className="h-11" />
          <div>
            <p className="font-semibold">{PAYSLIP_ORGANISATION}</p>
            <p className="text-muted-foreground text-sm">Payslip · {monthLabel(slip.monthKey)}</p>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-muted-foreground text-xs">Payslip no.</p>
          <p className="font-mono font-semibold">{p.payslip_no}</p>
        </div>
      </div>

      <CardContent className="space-y-6 p-5 sm:p-6">
        <div className="grid gap-6 md:grid-cols-2">
          <section aria-labelledby="slip-member">
            <h2 id="slip-member" className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
              Paid to
            </h2>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Name" value={p.member_name} />
              <Field label="NIC" value={p.member_nic} mono />
              <Field label="Email" value={p.member_email} />
              <Field label="Phone" value={p.member_phone} />
            </dl>
          </section>
          <section aria-labelledby="slip-bank">
            <h2 id="slip-bank" className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
              Bank account
            </h2>
            {p.bank_name ? (
              <dl className="grid grid-cols-2 gap-3">
                <Field label="Bank" value={p.bank_name} />
                <Field label="Branch" value={p.bank_branch} />
                <Field label="Account holder" value={p.account_holder} />
                <Field label="Account" value={maskAccountNumber(p.account_last4)} mono />
              </dl>
            ) : (
              <p className="text-muted-foreground text-sm">No bank details were saved when this month was closed.</p>
            )}
          </section>
        </div>

        <Separator />

        <section aria-labelledby="slip-earnings" className="space-y-2">
          <h2 id="slip-earnings" className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Earnings
          </h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-3 sm:pl-4">Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Rate</TableHead>
                  <TableHead className="pr-3 text-right sm:pr-4">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slip.salaryLines.map((l) => (
                  <TableRow key={`s-${l.roleId}`}>
                    <TableCell className="pl-3 whitespace-normal sm:pl-4">
                      <p className="font-medium">{l.role}</p>
                      <p className="text-muted-foreground text-xs">Fixed monthly salary</p>
                    </TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">—</TableCell>
                    <TableCell className="pr-3 text-right tabular-nums sm:pr-4">{formatLKR(l.amount)}</TableCell>
                  </TableRow>
                ))}
                {slip.workLines.map((l, i) => (
                  <TableRow key={`w-${i}`}>
                    <TableCell className="pl-3 whitespace-normal sm:pl-4">
                      <p className="font-medium">{workLineLabel(l)}</p>
                      <p className="text-muted-foreground text-xs">
                        {l.items} approved submission{l.items === 1 ? "" : "s"}
                        {l.unitPrice === null && " · no rate set"}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(l.quantity)}
                      {l.unit && <span className="text-muted-foreground block text-xs sm:inline sm:text-sm"> {l.unit}</span>}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {l.unitPrice === null ? "—" : formatLKR(l.unitPrice)}
                    </TableCell>
                    <TableCell className="pr-3 text-right tabular-nums sm:pr-4">{formatLKR(l.amount)}</TableCell>
                  </TableRow>
                ))}
                {slip.salaryLines.length + slip.workLines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground py-6 text-center whitespace-normal">
                      Nothing was earned this month.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-muted-foreground px-3 text-right text-xs font-normal whitespace-normal sm:px-4 sm:text-sm"
                  >
                    Salary {formatLKR(p.salary_amount)} + Work {formatLKR(p.work_amount)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </section>

        <div className="bg-muted/40 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-muted-foreground text-sm">Total</p>
            <p className="text-3xl font-bold tracking-tight tabular-nums">
              <GradientText>{formatLKR(p.total_amount)}</GradientText>
            </p>
          </div>
          <div className="sm:text-right">
            {paid ? (
              <>
                <Badge variant="success" className="text-sm">
                  <BadgeCheckIcon /> Paid on {formatDate(p.paid_on)}
                </Badge>
                {p.payment_reference && (
                  <p className="text-muted-foreground mt-1 text-xs">Reference: {p.payment_reference}</p>
                )}
              </>
            ) : p.total_amount > 0 ? (
              <Badge variant="warning" className="text-sm">
                <CircleDashedIcon /> Not paid yet
              </Badge>
            ) : (
              <Badge variant="outline" className="text-sm">
                Nothing to pay
              </Badge>
            )}
          </div>
        </div>

        <p className="text-muted-foreground text-xs">
          Amounts were saved when {monthLabel(slip.monthKey)} was closed
          {slip.closedAt && <> on {formatDateTime(slip.closedAt)}</>}. Prices of approved work are locked at approval.
        </p>
      </CardContent>
    </Card>
  );
}
