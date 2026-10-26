import type { Metadata } from "next";
import Link from "next/link";
import { BanknoteIcon, ClockIcon, DownloadIcon, InfoIcon, TrendingUpIcon, UsersIcon, WalletIcon } from "lucide-react";
import { BudgetDialog } from "@/components/analytics/budget-dialog";
import { BudgetRadial } from "@/components/analytics/budget-radial";
import { SectionDonut } from "@/components/analytics/section-donut";
import { SpendRadar } from "@/components/analytics/spend-radar";
import { EmptyState } from "@/components/empty-state";
import { MonthSelect } from "@/components/month-select";
import BlurText from "@/components/reactbits/blur-text";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAnalytics, percentChange } from "@/lib/analytics";
import { requireMainAdmin } from "@/lib/auth";
import { formatLKR, formatNumber, maskAccountNumber } from "@/lib/format";
import { monthLabel, parseMonthParam, shiftMonth } from "@/lib/month";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  await requireMainAdmin();
  const month = parseMonthParam((await searchParams).month);
  const supabase = await createClient();
  const data = await getAnalytics(supabase, month, 6);

  const label = monthLabel(month);
  const rangeLabel = `${monthLabel(shiftMonth(month, -5), "short")} – ${monthLabel(month, "short")}`;
  const change = percentChange(data.spent, data.previousSpent);
  const paidMembers = data.payouts.filter((p) => p.spent > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <BlurText as="h1" text="Analytics" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
          <p className="text-muted-foreground text-sm">How much the team costs, for main admins only.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthSelect value={month} />
          <Button asChild variant="outline">
            <a href={`/admin/analytics/payouts?month=${month}`} download>
              <DownloadIcon /> Payouts CSV
            </a>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={`Spent in ${monthLabel(month, "short")}`}
          value={data.spent}
          prefix="Rs."
          icon={WalletIcon}
          hint="Approved work"
        />
        <StatCard
          label="Waiting for review"
          value={data.pending}
          prefix="Rs."
          icon={ClockIcon}
          tone="warning"
          hint="At today's rates"
          delay={0.1}
        />
        <StatCard
          label="Last 6 months"
          value={data.periodSpent}
          prefix="Rs."
          icon={TrendingUpIcon}
          tone="info"
          hint={rangeLabel}
          delay={0.2}
        />
        <StatCard label="Members paid" value={paidMembers} icon={UsersIcon} tone="success" hint={label} delay={0.3} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SpendRadar data={data.months} change={change} rangeLabel={rangeLabel} />
        <SectionDonut data={data.sections} monthLabel={label} />
        <BudgetRadial
          spent={data.spent}
          pending={data.pending}
          budget={data.budget}
          monthLabel={label}
          action={<BudgetDialog budget={data.budget} />}
        />
      </div>

      {(data.salariedRoles.length > 0 || data.unpricedApproved > 0) && (
        <div className="text-muted-foreground flex gap-2 rounded-xl border p-3 text-sm">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            {data.salariedRoles.length > 0 && (
              <>{data.salariedRoles.join(" and ")} are on a fixed salary and not counted here. </>
            )}
            {data.unpricedApproved > 0 && (
              <>
                {data.unpricedApproved} approved submission{data.unpricedApproved === 1 ? " has" : "s have"} no work
                type, so {data.unpricedApproved === 1 ? "it counts" : "they count"} as Rs. 0. Set prices in{" "}
                <Link href="/admin/rates" className="text-primary hover:underline">
                  Rates &amp; budget
                </Link>
                .
              </>
            )}
          </p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Payouts</CardTitle>
            <CardDescription>What each member is owed for {label}</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {data.payouts.length === 0 ? (
              <EmptyState icon={BanknoteIcon} title="No work this month" className="mx-6" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Member</TableHead>
                    <TableHead className="hidden sm:table-cell">Bank</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="pr-6 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.payouts.map((p) => (
                    <TableRow key={p.userId}>
                      <TableCell className="pl-6">
                        <Link href={`/admin/members/${p.userId}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        {p.pending > 0 && (
                          <p className="text-muted-foreground text-xs">+ {formatLKR(p.pending)} pending</p>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">
                        {p.bankName ? (
                          <>
                            {p.bankName}
                            <br />
                            <span className="font-mono">{maskAccountNumber(p.bankLast4)}</span>
                          </>
                        ) : (
                          "Not added"
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.approvedItems}</TableCell>
                      <TableCell className="pr-6 text-right font-semibold tabular-nums">{formatLKR(p.spent)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Spending by role</CardTitle>
            <CardDescription>Approved units and cost for {label}</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {data.roles.length === 0 ? (
              <EmptyState icon={WalletIcon} title="No work this month" className="mx-6" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Role</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Pending</TableHead>
                    <TableHead className="pr-6 text-right">Spent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.roles.map((r) => (
                    <TableRow key={r.roleId}>
                      <TableCell className="pl-6">
                        <p className="font-medium">{r.role}</p>
                        <p className="text-muted-foreground text-xs">{r.section}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(r.units)}</TableCell>
                      <TableCell className="text-muted-foreground hidden text-right tabular-nums sm:table-cell">
                        {formatLKR(r.pending)}
                      </TableCell>
                      <TableCell className="pr-6 text-right font-semibold tabular-nums">{formatLKR(r.spent)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
