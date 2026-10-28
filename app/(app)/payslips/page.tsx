import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheckIcon, CircleDashedIcon, DownloadIcon, FileTextIcon, TrendingUpIcon, WalletIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { MonthBars } from "@/components/team/month-bars";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireUser } from "@/lib/auth";
import { MEMBERS_CAN_SEE_PAYSLIPS } from "@/lib/config";
import { formatDate, formatLKR } from "@/lib/format";
import { getMySalary, getSubmissionsForMonth, summarise } from "@/lib/member-queries";
import { currentMonthKey, dateToMonthKey, monthLabel, todayISO } from "@/lib/month";
import { normalisePayout } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My earnings" };

/**
 * Earnings and payments history: every closed month (earned, paid on,
 * reference, payslip), a chart for the year and the year's totals.
 */
export default async function MyEarningsPage({ searchParams }: PageProps<"/payslips">) {
  const profile = await requireUser();

  if (!MEMBERS_CAN_SEE_PAYSLIPS) {
    return (
      <div className="space-y-6">
        <PageHeader title="My earnings" />
        <EmptyState
          icon={FileTextIcon}
          title="Payslips are not shared"
          description="Ask a main admin for your payslip."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const thisMonth = currentMonthKey();
  const [{ data }, salary, monthWork] = await Promise.all([
    supabase.from("payouts").select("*").eq("user_id", profile.id).order("month", { ascending: false }).limit(120),
    getMySalary(supabase, profile.id),
    getSubmissionsForMonth(supabase, profile.id, thisMonth),
  ]);
  const payslips = (data ?? []).map(normalisePayout);

  // This month so far (not closed yet): approved work + salary earned day by day.
  const closedThisMonth = payslips.some((p) => dateToMonthKey(p.month) === thisMonth);
  const today = todayISO();
  const [y, m] = thisMonth.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const soFar = closedThisMonth
    ? 0
    : summarise(monthWork).earnedApproved + (salary * Number(today.slice(8, 10))) / daysInMonth;

  const years = [...new Set([thisMonth.slice(0, 4), ...payslips.map((p) => p.month.slice(0, 4))])].sort().reverse();
  const asked = String((await searchParams).year ?? "");
  const year = years.includes(asked) ? asked : years[0];
  const inYear = payslips.filter((p) => p.month.startsWith(year));

  const earned = inYear.reduce((s, p) => s + p.total_amount, 0);
  const paid = inYear.filter((p) => p.status === "paid").reduce((s, p) => s + p.total_amount, 0);
  const waiting = inYear.filter((p) => p.status === "unpaid" && p.total_amount > 0);

  const chart = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    const slip = inYear.find((p) => dateToMonthKey(p.month) === key);
    const value = slip ? slip.total_amount : key === thisMonth ? Math.round(soFar) : 0;
    return { label: monthLabel(key, "short").split(" ")[0] + (key === thisMonth && !slip ? "*" : ""), value };
  }).filter((d, i, all) => d.value > 0 || all.slice(i).some((x) => x.value > 0) || i === 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My earnings"
        description="Everything you earned and were paid. A payslip is ready when a main admin closes the month."
        actions={
          years.length > 1 ? (
            <Tabs value={year}>
              <TabsList>
                {years.map((yy) => (
                  <TabsTrigger key={yy} value={yy} asChild>
                    <Link href={`/payslips?year=${yy}`}>{yy}</Link>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`Earned in ${year}`} value={earned} prefix="Rs." icon={TrendingUpIcon} hint="closed months" />
        <StatCard
          label={`Paid in ${year}`}
          value={paid}
          prefix="Rs."
          icon={BadgeCheckIcon}
          tone="success"
          delay={0.1}
        />
        <StatCard
          label="Waiting for payment"
          value={waiting.reduce((s, p) => s + p.total_amount, 0)}
          prefix="Rs."
          icon={CircleDashedIcon}
          tone="warning"
          hint={`${waiting.length} payslip${waiting.length === 1 ? "" : "s"}`}
          delay={0.2}
        />
        <StatCard
          label={`${monthLabel(thisMonth, "short")} so far`}
          value={Math.round(soFar)}
          prefix="Rs."
          icon={WalletIcon}
          tone="info"
          hint={closedThisMonth ? "month closed" : "not closed yet"}
          delay={0.3}
        />
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Earnings in {year}</CardTitle>
          <CardDescription>
            Each closed month&apos;s total (salary + approved work).
            {chart.some((c) => c.label.endsWith("*")) && " * this month so far."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonthBars label="Earned" money data={chart} />
        </CardContent>
      </Card>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Payments</CardTitle>
          <CardDescription>
            {inYear.length === 0
              ? `No closed months in ${year} yet.`
              : `${inYear.length} month${inYear.length === 1 ? "" : "s"} in ${year}`}
          </CardDescription>
        </CardHeader>
        {inYear.length > 0 && (
          <CardContent className="px-0 sm:px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4 sm:pl-2">Month</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Salary</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Work</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Reference</TableHead>
                  <TableHead className="pr-4 text-right sm:pr-2">Payslip</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inYear.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-4 sm:pl-2">
                      <p className="font-medium">{monthLabel(dateToMonthKey(p.month))}</p>
                      <p className="text-muted-foreground font-mono text-xs">{p.payslip_no}</p>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {formatLKR(p.salary_amount)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {formatLKR(p.work_amount)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatLKR(p.total_amount)}</TableCell>
                    <TableCell>
                      {p.status === "paid" ? (
                        <Badge variant="success">
                          <BadgeCheckIcon /> Paid {formatDate(p.paid_on)}
                        </Badge>
                      ) : p.total_amount > 0 ? (
                        <Badge variant="warning">
                          <CircleDashedIcon /> Not paid yet
                        </Badge>
                      ) : (
                        <Badge variant="outline">Nothing to pay</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden font-mono text-xs lg:table-cell">
                      {p.payment_reference || "—"}
                    </TableCell>
                    <TableCell className="pr-4 text-right sm:pr-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          aria-label={`View payslip for ${monthLabel(dateToMonthKey(p.month))}`}
                        >
                          <Link href={`/payslips/${p.id}`}>
                            <FileTextIcon />
                          </Link>
                        </Button>
                        <Button
                          asChild
                          variant="ghost"
                          size="icon"
                          aria-label={`Download payslip PDF for ${monthLabel(dateToMonthKey(p.month))}`}
                        >
                          <a href={`/payslips/${p.id}/pdf`} download>
                            <DownloadIcon />
                          </a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <tfoot>
                <TableRow className="hover:bg-transparent">
                  <TableCell className="pl-4 font-semibold sm:pl-2">Total {year}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {formatLKR(inYear.reduce((s, p) => s + p.salary_amount, 0))}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {formatLKR(inYear.reduce((s, p) => s + p.work_amount, 0))}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatLKR(earned)}</TableCell>
                  <TableCell colSpan={3} className="text-muted-foreground text-xs">
                    Paid {formatLKR(paid)}
                  </TableCell>
                </TableRow>
              </tfoot>
            </Table>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
