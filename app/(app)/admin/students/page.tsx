import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, BadgeCheckIcon, ClockIcon, IdCardIcon, PlusIcon, SearchCheckIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { StatCard } from "@/components/stat-card";
import { StudentDialog } from "@/components/students/student-dialog";
import { StudentFilters } from "@/components/students/student-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth";
import { getClassOptions } from "@/lib/organisation/classes";
import { CARD_LABEL, CARD_TYPES, STATUS_BADGE, STATUS_LABEL } from "@/lib/students/rules";
import { getConcessionStudents, type StudentRow } from "@/lib/students/queries";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Concession students" };

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Needs attention first: under review, verified but now incomplete, waiting to verify, the rest, ended. */
function rank(s: StudentRow) {
  if (s.status === "under_review") return 0;
  if (s.status === "verified" && s.missing.length > 0) return 1;
  if (s.status === "applied") return 2;
  if (s.status === "verified") return 3;
  return 4;
}

export default async function StudentsPage({ searchParams }: PageProps<"/admin/students">) {
  const { canEdit } = await requirePage("students");
  const sp = await searchParams;
  const q = param(sp.q).trim().toLowerCase();
  const batch = param(sp.batch);
  const card = param(sp.card);
  const status = param(sp.status);

  const supabase = await createClient();
  const [all, options] = await Promise.all([getConcessionStudents(supabase), getClassOptions(supabase)]);
  const batchName = new Map(options.batches.map((b) => [b.id, b.name]));
  const centreName = new Map(options.centres.map((c) => [c.id, c.name]));

  const students = all
    .filter((s) => {
      if (q && !s.fullName.toLowerCase().includes(q) && !s.studentNo.toLowerCase().includes(q)) return false;
      if (batch && s.batchId !== batch) return false;
      if (card && s.card !== card) return false;
      if (status === "missing") return s.status !== "ended" && s.missing.length > 0;
      if (status && s.status !== status) return false;
      return true;
    })
    .sort((a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName));

  const current = all.filter((s) => s.status !== "ended");
  const byCard = CARD_TYPES.map((c) => `${current.filter((s) => s.card === c).length} ${CARD_LABEL[c]}`).join(" · ");
  const activeBatches = options.batches.filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name }));
  const activeCentres = options.centres.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Concession students"
        description="Free, Half and Paid card students. GN certificates and family details are private to admins."
        actions={
          canEdit && activeBatches.length > 0 ? (
            <StudentDialog batches={activeBatches} centres={activeCentres}>
              <Button>
                <PlusIcon /> Register student
              </Button>
            </StudentDialog>
          ) : undefined
        }
      />
      {!canEdit && <ReadOnlyNotice />}
      {canEdit && activeBatches.length === 0 && (
        <p className="bg-warning/15 rounded-lg p-3 text-sm">
          Add a batch in <Link href="/admin/classes" className="font-medium underline">Batches &amp; exams</Link> first.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Current students" value={current.length} icon={IdCardIcon} hint={byCard} />
        <StatCard
          label="Verified"
          value={current.filter((s) => s.status === "verified").length}
          icon={BadgeCheckIcon}
          tone="success"
          hint="GN certificate checked"
          delay={0.1}
        />
        <StatCard
          label="Waiting to verify"
          value={current.filter((s) => s.status === "applied").length}
          icon={ClockIcon}
          tone="warning"
          hint="Applied, not checked yet"
          delay={0.2}
        />
        <StatCard
          label="Under review"
          value={current.filter((s) => s.status === "under_review").length}
          icon={SearchCheckIcon}
          tone="info"
          hint="Card being looked at again"
          delay={0.3}
        />
      </div>

      <StudentFilters batches={options.batches.map((b) => ({ id: b.id, name: b.name }))} />

      {students.length === 0 ? (
        <EmptyState
          icon={IdCardIcon}
          title={all.length === 0 ? "No concession students yet" : "No students found"}
          description={all.length === 0 ? "Register the first Free, Half or Paid card student." : "Try changing the search or filters."}
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Student</TableHead>
                <TableHead className="hidden md:table-cell">Batch</TableHead>
                <TableHead>Card</TableHead>
                <TableHead className="hidden pr-4 sm:table-cell">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => {
                const incomplete = s.status !== "ended" && s.missing.length > 0;
                return (
                  <TableRow
                    key={s.id}
                    className={cn(
                      s.status === "under_review" && "bg-destructive/5",
                      s.status === "verified" && incomplete && "bg-warning/10",
                      s.status === "ended" && "opacity-60",
                    )}
                  >
                    <TableCell className="pl-4">
                      <Link href={`/admin/students/${s.id}`} className="block min-w-0">
                        <p className="truncate font-medium hover:underline">{s.fullName}</p>
                        <p className="text-muted-foreground truncate text-xs">
                          {s.studentNo}
                          <span className="md:hidden"> · {batchName.get(s.batchId)}</span>
                        </p>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-sm md:table-cell">
                      {batchName.get(s.batchId)}
                      {s.centreId && <span className="block text-xs">{centreName.get(s.centreId)}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{CARD_LABEL[s.card]}</Badge>
                      <Badge variant={STATUS_BADGE[s.status]} className="ml-1 sm:hidden">
                        {STATUS_LABEL[s.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden pr-4 sm:table-cell">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant={STATUS_BADGE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                        {incomplete && (
                          <Badge variant="warning" title={`Missing: ${s.missing.join(", ")}`}>
                            <AlertTriangleIcon /> {s.missing.length} missing
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
