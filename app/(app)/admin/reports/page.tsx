import type { Metadata } from "next";
import { CheckCircle2Icon, DownloadIcon, FileBarChartIcon, HashIcon, UsersIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MonthSelect } from "@/components/month-select";
import { PageHeader } from "@/components/page-header";
import { ReportTabs } from "@/components/report-tabs";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { monthLabel, parseMonthParam } from "@/lib/month";
import { getMonthlyReport } from "@/lib/report";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Monthly report" };

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  await requirePage("reports");
  const month = parseMonthParam((await searchParams).month);
  const supabase = await createClient();
  const report = await getMonthlyReport(supabase, month);

  const totalCount = report.reduce((s, m) => s + m.totalCount, 0);
  const totalQuantity = report.reduce((s, m) => s + m.totalQuantity, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monthly report"
        description="Approved work per member, grouped by role."
        actions={
          <>
            <ReportTabs value="month" />
            <MonthSelect value={month} />
            <Button asChild variant="outline" disabled={report.length === 0}>
              <a href={`/admin/reports/export?month=${month}`} download>
                <DownloadIcon /> Export CSV
              </a>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Members with work" value={report.length} icon={UsersIcon} />
        <StatCard label="Approved items" value={totalCount} icon={CheckCircle2Icon} tone="success" delay={0.1} />
        <StatCard label="Total quantity" value={totalQuantity} icon={HashIcon} tone="info" delay={0.2} />
      </div>

      {report.length === 0 ? (
        <EmptyState
          icon={FileBarChartIcon}
          title={`No approved work for ${monthLabel(month)}`}
          description="Approved submissions will appear here."
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Approved</TableHead>
                <TableHead className="pr-4 text-right">Quantity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.map((member) =>
                member.lines.map((line, index) => (
                  <TableRow key={`${member.userId}-${line.roleName}`} className={index === 0 ? "border-t-2" : undefined}>
                    {index === 0 && (
                      <TableCell rowSpan={member.lines.length} className="bg-muted/30 pl-4 align-top">
                        <p className="font-medium">{member.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {member.totalCount} approved · qty {formatNumber(member.totalQuantity)}
                        </p>
                      </TableCell>
                    )}
                    <TableCell>
                      <p>{line.roleName}</p>
                      <p className="text-muted-foreground text-xs">{line.sectionName}</p>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{line.count}</TableCell>
                    <TableCell className="pr-4 text-right font-medium tabular-nums">{formatNumber(line.quantity)}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="pl-4" colSpan={2}>
                  Total for {monthLabel(month)}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{totalCount}</TableCell>
                <TableCell className="pr-4 text-right tabular-nums">{formatNumber(totalQuantity)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </Card>
      )}
    </div>
  );
}
