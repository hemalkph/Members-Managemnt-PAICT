import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2Icon, FileStackIcon, GraduationCapIcon, HashIcon } from "lucide-react";
import { ExamReportFilters } from "@/components/classes/exam-report-filters";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ReportTabs } from "@/components/report-tabs";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth";
import { getClassOptions } from "@/lib/classes";
import { formatDate, formatNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Work by exam" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type RoleLine = { role: string; approved: number; quantity: number; pending: number; members: Set<string> };

export default async function ExamReportPage({ searchParams }: PageProps<"/admin/reports/exams">) {
  await requirePage("reports");
  const sp = await searchParams;
  const supabase = await createClient();
  const options = await getClassOptions(supabase);

  const batchId = uuid.safeParse(one(sp.batch)).success
    ? one(sp.batch)
    : (options.batches.find((b) => b.isActive)?.id ?? options.batches[0]?.id ?? "");
  const centreId = uuid.safeParse(one(sp.centre)).success ? one(sp.centre) : "";
  const exams = options.exams.filter((e) => e.batchId === batchId);
  const examIds = exams.map((e) => e.id);

  let workQuery = supabase
    .from("submissions")
    .select("exam_id, user_id, status, quantity, roles(name)")
    .in("exam_id", examIds.length ? examIds : ["00000000-0000-0000-0000-000000000000"])
    .neq("status", "rejected")
    .limit(10000);
  if (centreId) workQuery = workQuery.eq("centre_id", centreId);

  const [{ data: work }, { data: papers }] = await Promise.all([
    workQuery,
    examIds.length
      ? supabase.from("papers").select("exam_id, status").in("exam_id", examIds).neq("status", "cancelled")
      : Promise.resolve({ data: [] as { exam_id: string | null; status: string }[] }),
  ]);

  const byExam = new Map<string, Map<string, RoleLine>>();
  for (const w of work ?? []) {
    if (!w.exam_id) continue;
    const roles = byExam.get(w.exam_id) ?? new Map<string, RoleLine>();
    const role = w.roles?.name ?? "Role";
    const line = roles.get(role) ?? { role, approved: 0, quantity: 0, pending: 0, members: new Set<string>() };
    if (w.status === "approved") {
      line.approved += 1;
      line.quantity += w.quantity;
      line.members.add(w.user_id);
    } else {
      line.pending += 1;
    }
    roles.set(role, line);
    byExam.set(w.exam_id, roles);
  }
  const paperStats = new Map<string, { total: number; done: number }>();
  for (const p of papers ?? []) {
    if (!p.exam_id) continue;
    const s = paperStats.get(p.exam_id) ?? { total: 0, done: 0 };
    s.total += 1;
    if (p.status === "done") s.done += 1;
    paperStats.set(p.exam_id, s);
  }

  const allLines = [...byExam.values()].flatMap((m) => [...m.values()]);
  const totalApproved = allLines.reduce((s, l) => s + l.approved, 0);
  const totalQuantity = allLines.reduce((s, l) => s + l.quantity, 0);
  const totalPapers = [...paperStats.values()].reduce((s, p) => s + p.total, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work by exam"
        description="Approved work per test and role, e.g. papers marked for Term Test 2."
        actions={<ReportTabs value="exam" />}
      />

      {options.batches.length === 0 ? (
        <EmptyState
          icon={GraduationCapIcon}
          title="No batches yet"
          description={
            <>
              Add batches and exams in{" "}
              <Link href="/admin/classes" className="text-primary hover:underline">
                Batches &amp; exams
              </Link>
              , then members can tag their work.
            </>
          }
        />
      ) : (
        <>
          <ExamReportFilters
            batches={options.batches.map((b) => ({ id: b.id, name: b.name }))}
            centres={options.centres.map((c) => ({ id: c.id, name: c.name }))}
            batchId={batchId}
            centreId={centreId}
          />

          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Approved items" value={totalApproved} icon={CheckCircle2Icon} tone="success" />
            <StatCard label="Total quantity" value={totalQuantity} icon={HashIcon} tone="info" delay={0.1} />
            <StatCard label="Papers in production" value={totalPapers} icon={FileStackIcon} delay={0.2} />
          </div>

          {exams.length === 0 ? (
            <EmptyState icon={GraduationCapIcon} title="No exams in this batch" />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {exams.map((exam) => {
                const lines = [...(byExam.get(exam.id)?.values() ?? [])].sort((a, b) => b.quantity - a.quantity);
                const ps = paperStats.get(exam.id);
                return (
                  <Card key={exam.id} className="min-w-0 gap-3">
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle>{exam.name}</CardTitle>
                        {!exam.isActive && <Badge variant="secondary">Inactive</Badge>}
                      </div>
                      <CardDescription>{exam.examDate ? formatDate(exam.examDate) : "No date set"}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 px-0">
                      {ps && (
                        <div className="space-y-1.5 px-6">
                          <div className="flex justify-between text-sm">
                            <Link href={`/admin/papers?exam=${exam.id}`} className="font-medium hover:underline">
                              Papers finished
                            </Link>
                            <span className="text-muted-foreground tabular-nums">
                              {ps.done} of {ps.total}
                            </span>
                          </div>
                          <Progress value={ps.total ? (ps.done / ps.total) * 100 : 0} indicatorClassName="bg-success" />
                        </div>
                      )}
                      {lines.length === 0 ? (
                        <p className="text-muted-foreground px-6 text-sm">No work tagged with this exam yet.</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-6">Role</TableHead>
                              <TableHead className="text-right">Approved</TableHead>
                              <TableHead className="text-right">Quantity</TableHead>
                              <TableHead className="hidden text-right sm:table-cell">Members</TableHead>
                              <TableHead className="pr-6 text-right">Pending</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {lines.map((l) => (
                              <TableRow key={l.role}>
                                <TableCell className="pl-6 font-medium">{l.role}</TableCell>
                                <TableCell className="text-right tabular-nums">{l.approved}</TableCell>
                                <TableCell className="text-right font-semibold tabular-nums">
                                  {formatNumber(l.quantity)}
                                </TableCell>
                                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                                  {l.members.size}
                                </TableCell>
                                <TableCell className="text-muted-foreground pr-6 text-right tabular-nums">
                                  {l.pending}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
