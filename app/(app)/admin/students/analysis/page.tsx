import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, CheckCircle2Icon } from "lucide-react";
import { MonthSelect } from "@/components/month-select";
import { ManualFlagBadge } from "@/components/students/manual-flags";
import { PrintButton } from "@/components/students/print-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth";
import { formatDateTime } from "@/lib/core/format";
import { isMonthKey, monthLabel } from "@/lib/core/month";
import { getClassOptions } from "@/lib/organisation/classes";
import { getMonthAnalysis, thisCalendarMonth, type AnalysisRow } from "@/lib/students/analysis";
import { FLAG_BADGE } from "@/lib/students/flags";
import { CARD_LABEL, CARD_TYPES, LOW_PERCENT } from "@/lib/students/rules";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Student analysis" };

const SEVERITY = { red: 0, orange: 1, yellow: 2 } as const;
const severity = (s: AnalysisRow) =>
  Math.min(...s.flags.map((f) => SEVERITY[f.level]), s.manualFlags.some((f) => f.kind !== "top") ? 1 : 3);

function summary(rows: AnalysisRow[]) {
  const present = rows.reduce((n, r) => n + r.stats.present, 0);
  const absent = rows.reduce((n, r) => n + r.stats.absent, 0);
  const averages = rows.map((r) => r.stats.averagePercent).filter((p): p is number => p !== null);
  const due = rows.filter((r) => r.paymentDue);
  return {
    students: rows.length,
    attendance: present + absent > 0 ? Math.round((present / (present + absent)) * 100) : null,
    average: averages.length ? Math.round((averages.reduce((s, p) => s + p, 0) / averages.length) * 10) / 10 : null,
    paid: due.filter((r) => r.payment === "paid").length,
    due: due.length,
  };
}

export default async function StudentAnalysisPage({ searchParams }: PageProps<"/admin/students/analysis">) {
  await requirePage("students");
  const sp = await searchParams;
  const raw = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  const month = isMonthKey(raw) && raw <= thisCalendarMonth() ? raw : thisCalendarMonth();

  const supabase = await createClient();
  const [all, options] = await Promise.all([getMonthAnalysis(supabase, month), getClassOptions(supabase)]);
  const batchName = new Map(options.batches.map((b) => [b.id, b.name]));
  const current = all.filter((s) => s.status !== "ended");
  const attention = current
    .filter((s) => s.flags.length > 0 || s.manualFlags.length > 0)
    .sort((a, b) => severity(a) - severity(b) || b.flags.length - a.flags.length || a.fullName.localeCompare(b.fullName));

  const groups = [
    ...CARD_TYPES.map((c) => ({ label: CARD_LABEL[c], rows: current.filter((s) => s.card === c), free: c === "free" })),
    { label: "All", rows: current, free: false },
  ];

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 print:hidden">
        <Link href="/admin/students">
          <ArrowLeftIcon /> Concession students
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Student analysis · {monthLabel(month)}</h1>
          <p className="text-muted-foreground text-sm">
            Exams dated in {monthLabel(month)}, payments for the month and every flag. Made {formatDateTime(new Date().toISOString())}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <MonthSelect value={month} calendar />
          <PrintButton />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By card type</CardTitle>
          <CardDescription>
            Attendance = present out of present and absent. Payments count Half and Paid cards verified by this month.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Card</TableHead>
                <TableHead className="text-right">Students</TableHead>
                <TableHead className="text-right">Attendance</TableHead>
                <TableHead className="text-right">Average mark</TableHead>
                <TableHead className="text-right">Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => {
                const s = summary(g.rows);
                return (
                  <TableRow key={g.label} className={g.label === "All" ? "font-medium" : undefined}>
                    <TableCell>{g.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.students}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.attendance === null ? "—" : `${s.attendance}%`}</TableCell>
                    <TableCell
                      className={cn("text-right tabular-nums", s.average !== null && s.average < LOW_PERCENT && "text-destructive")}
                    >
                      {s.average === null ? "—" : `${s.average}%`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{g.free ? "—" : s.due === 0 ? "—" : `${s.paid} / ${s.due}`}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Needs attention ({attention.length})</CardTitle>
          <CardDescription>Automatic flags for {monthLabel(month)} and open flags raised by admins. Most serious first.</CardDescription>
        </CardHeader>
        <CardContent>
          {attention.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <CheckCircle2Icon className="text-success size-4" /> No student is flagged this month.
            </p>
          ) : (
            <ul className="divide-y">
              {attention.map((s) => (
                <li key={s.id} className={cn("py-3", severity(s) === 0 && "bg-destructive/5 -mx-2 rounded-md px-2")}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link href={`/admin/students/${s.id}`} className="font-medium hover:underline">
                      {s.fullName}
                    </Link>
                    <span className="text-muted-foreground text-xs">
                      {s.studentNo} · {batchName.get(s.batchId)} · {CARD_LABEL[s.card]}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {s.flags.map((f) => (
                      <Badge key={f.key} variant={FLAG_BADGE[f.level]}>
                        {f.label}
                      </Badge>
                    ))}
                    {s.manualFlags.map((f) => (
                      <span key={f.id} title={f.reason}>
                        <ManualFlagBadge kind={f.kind} />
                      </span>
                    ))}
                  </div>
                  {s.manualFlags.map((f) => (
                    <p key={f.id} className="text-muted-foreground mt-1 text-xs break-words">
                      {f.reason}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Every student this month</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Card</TableHead>
                <TableHead className="text-right">Exams sat</TableHead>
                <TableHead className="text-right">Average</TableHead>
                <TableHead className="text-right">Payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...current]
                .sort((a, b) => a.fullName.localeCompare(b.fullName))
                .map((s) => (
                  <TableRow key={s.id} className={s.stats.absent > 0 ? "bg-destructive/5" : undefined}>
                    <TableCell>
                      <Link href={`/admin/students/${s.id}`} className="font-medium hover:underline">
                        {s.fullName}
                      </Link>
                      <span className="text-muted-foreground block text-xs">
                        {s.studentNo} · {batchName.get(s.batchId)}
                      </span>
                    </TableCell>
                    <TableCell>{CARD_LABEL[s.card]}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.stats.held === 0 ? "—" : `${s.stats.present} / ${s.stats.held}`}
                      {s.stats.absent > 0 && <span className="text-destructive block text-xs">{s.stats.absent} absent</span>}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        s.stats.averagePercent !== null && s.stats.averagePercent < LOW_PERCENT && "text-destructive font-medium",
                      )}
                    >
                      {s.stats.averagePercent === null ? "—" : `${s.stats.averagePercent}%`}
                    </TableCell>
                    <TableCell className="text-right">
                      {!s.paymentDue ? (
                        <span className="text-muted-foreground">—</span>
                      ) : s.payment === "paid" ? (
                        <Badge variant="success">Paid</Badge>
                      ) : s.payment === "unpaid" ? (
                        <Badge variant="destructive">Unpaid</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">Not recorded</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
