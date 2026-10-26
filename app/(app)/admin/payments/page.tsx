import type { Metadata } from "next";
import Link from "next/link";
import {
  BadgeCheckIcon,
  BanknoteIcon,
  CircleDashedIcon,
  ClipboardCheckIcon,
  DownloadIcon,
  LockIcon,
  LockOpenIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MonthSelect } from "@/components/month-select";
import { CloseMonthDialog } from "@/components/payments/close-month-dialog";
import { PaymentSteps } from "@/components/payments/payment-steps";
import { PayoutsTable, type PayoutRow } from "@/components/payments/payouts-table";
import { ReopenMonthButton } from "@/components/payments/reopen-month-button";
import BlurText from "@/components/reactbits/blur-text";
import { StatCard } from "@/components/stat-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAnalytics } from "@/lib/analytics";
import { requireMainAdmin } from "@/lib/auth";
import { formatDateTime, formatLKR } from "@/lib/format";
import { currentMonthKey, monthKeyToDate, monthLabel, parseMonthParam, todayISO } from "@/lib/month";
import { getPayMonth, getPayoutsForMonth, payoutTotals } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  await requireMainAdmin();
  const month = parseMonthParam((await searchParams).month);
  const label = monthLabel(month);
  const supabase = await createClient();

  const [payMonth, { count: pendingCount }] = await Promise.all([
    getPayMonth(supabase, month),
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("work_month", monthKeyToDate(month))
      .eq("status", "pending"),
  ]);
  const pending = pendingCount ?? 0;
  const isFuture = month > currentMonthKey();

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <BlurText as="h1" text="Payments" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
        <p className="text-muted-foreground text-sm">Close each month, pay the team and share payslips.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <MonthSelect value={month} />
        <Button asChild variant="outline">
          <a href={`/admin/analytics/payouts?month=${month}`} download>
            <DownloadIcon /> Payroll CSV
          </a>
        </Button>
      </div>
    </div>
  );

  // ---------------------------------------------------------------- open month
  if (!payMonth) {
    const preview = await getAnalytics(supabase, month, 1);
    const owed = preview.payouts.filter((p) => p.total > 0 || p.approvedItems > 0);
    const total = owed.reduce((s, p) => s + p.total, 0);

    return (
      <div className="space-y-6">
        {header}
        <PaymentSteps
          steps={[
            {
              title: "Review all work",
              hint: pending > 0 ? `${pending} pending` : "Nothing waiting",
              done: pending === 0 && !isFuture,
            },
            { title: "Close the month", hint: "Locks work, creates payslips", done: false },
            { title: "Pay members", hint: "Use the payroll CSV", done: false },
            { title: "Payslips shared", hint: "Members download them", done: false },
          ]}
        />

        <Alert variant={pending > 0 || isFuture ? "warning" : "default"}>
          <LockOpenIcon />
          <AlertTitle>{label} is open</AlertTitle>
          <AlertDescription>
            {isFuture ? (
              <p>This month hasn&apos;t started yet.</p>
            ) : pending > 0 ? (
              <p>
                {pending} submission{pending === 1 ? " is" : "s are"} still waiting for review.{" "}
                <Link href={`/admin/review?month=${month}&status=pending`} className="text-primary font-medium hover:underline">
                  Review them
                </Link>{" "}
                before closing the month.
              </p>
            ) : (
              <p>
                Members can still log and change work. When everything is reviewed, close the month to lock the amounts
                and create payslips.
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <CloseMonthDialog
                month={month}
                monthLabel={label}
                members={owed.length}
                total={total}
                disabled={pending > 0 || isFuture}
              />
              {pending > 0 && (
                <Button asChild variant="outline">
                  <Link href={`/admin/review?month=${month}&status=pending`}>
                    <ClipboardCheckIcon /> Go to work review
                  </Link>
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Estimated payouts</CardTitle>
            <CardDescription>
              Salaries + approved work for {label}. Final amounts are saved when you close the month.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {owed.length === 0 ? (
              <EmptyState icon={BanknoteIcon} title="Nothing to pay yet" className="mx-6" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Member</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Salary</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Work</TableHead>
                    <TableHead className="pr-6 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {owed.map((p) => (
                    <TableRow key={p.userId}>
                      <TableCell className="pl-6 font-medium">{p.name}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {p.salary > 0 ? formatLKR(p.salary) : "—"}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {p.spent > 0 ? formatLKR(p.spent) : "—"}
                      </TableCell>
                      <TableCell className="pr-6 text-right font-semibold tabular-nums">{formatLKR(p.total)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="pl-6 font-semibold">Total</TableCell>
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className="pr-6 text-right font-semibold tabular-nums">{formatLKR(total)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------------- closed month
  const payouts = await getPayoutsForMonth(supabase, month);
  const totals = payoutTotals(payouts);
  const ids = payouts.map((p) => p.user_id).filter((id): id is string => Boolean(id));
  const { data: banks } = ids.length
    ? await supabase.from("bank_details").select("user_id, bank_name, account_last4, updated_at").in("user_id", ids)
    : { data: [] };
  const bankByUser = new Map((banks ?? []).map((b) => [b.user_id, b]));
  const paidPercent = totals.total > 0 ? Math.round((totals.paid / totals.total) * 100) : totals.paidCount > 0 ? 100 : 0;
  const allPaid = totals.unpaidCount === 0;

  const rows: PayoutRow[] = payouts.map((p) => {
    const live = p.user_id ? bankByUser.get(p.user_id) : undefined;
    return {
      id: p.id,
      payslipNo: p.payslip_no,
      userId: p.user_id,
      name: p.member_name,
      bankName: p.bank_name,
      last4: p.account_last4,
      bankChanged: Boolean(
        live && (live.account_last4 !== p.account_last4 || live.bank_name !== p.bank_name) && p.status === "unpaid",
      ),
      salary: p.salary_amount,
      work: p.work_amount,
      total: p.total_amount,
      items: p.approved_items,
      status: p.status,
      paidOn: p.paid_on,
      reference: p.payment_reference,
    };
  });

  return (
    <div className="space-y-6">
      {header}
      <PaymentSteps
        steps={[
          { title: "Review all work", hint: "Done", done: true },
          { title: "Close the month", hint: `Closed ${formatDateTime(payMonth.closedAt)}`, done: true },
          {
            title: "Pay members",
            hint: `${totals.toPayCount - totals.unpaidCount} of ${totals.toPayCount} marked as paid`,
            done: allPaid,
          },
          { title: "Payslips shared", hint: "Members see them in My payslips", done: allPaid },
        ]}
      />

      <Alert variant="success">
        <LockIcon />
        <AlertTitle>{label} is closed</AlertTitle>
        <AlertDescription>
          <p>
            Closed {formatDateTime(payMonth.closedAt)}
            {payMonth.closedByName && <> by {payMonth.closedByName}</>}. Work for this month can&apos;t be changed.
          </p>
          {payMonth.note && <p className="italic">“{payMonth.note}”</p>}
          <div className="mt-2">
            <ReopenMonthButton month={month} monthLabel={label} hasPaid={totals.paidCount > 0} />
          </div>
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total to pay" value={totals.total} prefix="Rs." icon={WalletIcon} hint={label} />
        <StatCard
          label="Paid"
          value={totals.paid}
          prefix="Rs."
          icon={BadgeCheckIcon}
          tone="success"
          hint={`${totals.paidCount} member${totals.paidCount === 1 ? "" : "s"}`}
          delay={0.1}
        />
        <StatCard
          label="Still to pay"
          value={totals.outstanding}
          prefix="Rs."
          icon={CircleDashedIcon}
          tone="warning"
          hint={`${totals.unpaidCount} member${totals.unpaidCount === 1 ? "" : "s"}`}
          delay={0.2}
        />
        <StatCard label="Payslips" value={totals.members} icon={UsersIcon} tone="info" hint="Created at closing" delay={0.3} />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Paid so far</span>
          <span className="text-muted-foreground tabular-nums">{paidPercent}%</span>
        </div>
        <Progress value={paidPercent} indicatorClassName="bg-success" aria-label="Paid so far" />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={BanknoteIcon} title="Nobody was owed money this month" />
      ) : (
        <PayoutsTable rows={rows} today={todayISO()} />
      )}
    </div>
  );
}
