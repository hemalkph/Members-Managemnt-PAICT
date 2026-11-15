import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ImportWizard } from "@/components/students/import-wizard";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth";
import { getClassOptions } from "@/lib/organisation/classes";
import { thisCalendarMonth } from "@/lib/students/analysis";
import { getConcessionStudents } from "@/lib/students/queries";
import { allRows } from "@/lib/supabase/all-rows";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Import concession students" };

export default async function StudentImportPage({ searchParams }: PageProps<"/admin/students/import">) {
  const { canEdit } = await requirePage("students");
  if (!canEdit) redirect("/admin/students");
  const sp = await searchParams;
  const kind = sp.kind === "payments" ? "payments" : "students";

  const supabase = await createClient();
  const [students, options] = await Promise.all([getConcessionStudents(supabase), getClassOptions(supabase)]);

  let wizard;
  if (kind === "students") {
    const batchName = new Map(options.batches.map((b) => [b.id, b.name]));
    const centreName = new Map(options.centres.map((c) => [c.id, c.name]));
    wizard = (
      <ImportWizard
        kind="students"
        batches={options.batches.map((b) => ({ id: b.id, name: b.name }))}
        centres={options.centres.map((c) => ({ id: c.id, name: c.name }))}
        existing={students.map((s) => ({
          id: s.id,
          studentNo: s.studentNo,
          fullName: s.fullName,
          batchName: batchName.get(s.batchId) ?? "",
          centreName: s.centreId ? (centreName.get(s.centreId) ?? null) : null,
          card: s.card,
          status: s.status,
        }))}
      />
    );
  } else {
    const payments = await allRows((a, b) =>
      supabase.from("concession_payments").select("student_id, month, status, amount").order("student_id").order("month").range(a, b),
    );
    wizard = (
      <ImportWizard
        kind="payments"
        students={students.map((s) => ({ id: s.id, studentNo: s.studentNo, fullName: s.fullName, card: s.card }))}
        payments={payments.map((p) => [`${p.student_id}:${p.month.slice(0, 7)}`, p.status, p.amount === null ? null : Number(p.amount)])}
        thisMonth={thisCalendarMonth()}
      />
    );
  }

  const tab = (k: "students" | "payments", label: string) => (
    <Link
      href={`/admin/students/import?kind=${k}`}
      aria-current={kind === k ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium",
        kind === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/students">
          <ArrowLeftIcon /> Concession students
        </Link>
      </Button>
      <PageHeader
        title="Import from CSV"
        description={
          kind === "students"
            ? "Add existing students in one go. Student IDs already registered are skipped and never changed."
            : "Add past monthly payments of Half and Paid card students. Months already recorded are skipped."
        }
      />
      <nav className="bg-muted inline-flex rounded-lg p-1" aria-label="What to import">
        {tab("students", "Students")}
        {tab("payments", "Payments")}
      </nav>
      {kind === "payments" && (
        <p className="text-muted-foreground text-sm">
          Payments count toward the unpaid flag from the month a student was verified, so import and verify the students
          first.
        </p>
      )}
      {wizard}
    </div>
  );
}
