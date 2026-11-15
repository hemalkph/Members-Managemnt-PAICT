import type { Metadata } from "next";
import { CalendarDaysIcon, ClipboardPenLineIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { ExamParts } from "@/components/students/exam-parts";
import { ExamPicker } from "@/components/students/exam-picker";
import { ResultsSheet } from "@/components/students/results-sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePage } from "@/lib/auth";
import { formatDate } from "@/lib/core/format";
import { getClassOptions } from "@/lib/organisation/classes";
import { getExamSheet } from "@/lib/students/results";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Student results" };

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function StudentResultsPage({ searchParams }: PageProps<"/admin/student-results">) {
  const { canEdit } = await requirePage("student_results");
  const sp = await searchParams;
  const supabase = await createClient();
  const options = await getClassOptions(supabase);

  const batches = options.batches.filter((b) => b.isActive);
  const exams = options.exams.filter((e) => e.isActive);
  const exam = exams.find((e) => e.id === param(sp.exam));
  // No batch chosen: start with the first one.
  const batchId = exam?.batchId ?? (batches.some((b) => b.id === param(sp.batch)) ? param(sp.batch) : (batches[0]?.id ?? ""));
  const sheet = exam ? await getExamSheet(supabase, exam.id) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student results"
        description="Attendance and marks of concession students, exam by exam. Each exam counts in the month of its date."
      />
      {!canEdit && <ReadOnlyNotice />}

      <ExamPicker
        batches={batches.map((b) => ({ id: b.id, name: b.name }))}
        exams={exams.map((e) => ({ id: e.id, name: e.name, batchId: e.batchId, examDate: e.examDate }))}
        batchId={batchId}
        examId={exam?.id ?? ""}
      />

      {!exam || !sheet ? (
        <EmptyState
          icon={ClipboardPenLineIcon}
          title="Choose an exam"
          description="Exams are added in Batches & exams. Pick the batch and the exam to enter results."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{exam.label}</CardTitle>
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <CalendarDaysIcon className="size-4" />
              {exam.examDate ? formatDate(exam.examDate) : "No exam date yet: add one in Batches & exams so it counts in a month."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ExamParts examId={exam.id} parts={sheet.parts} canEdit={canEdit} />
            {sheet.parts.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Add the parts of this exam first, e.g. “Paper I (MCQ)” out of 40 and “Paper II” out of 60.
              </p>
            ) : (
              <ResultsSheet
                key={exam.id}
                examId={exam.id}
                parts={sheet.parts}
                rows={sheet.rows}
                centres={Object.fromEntries(options.centres.map((c) => [c.id, c.name]))}
                canEdit={canEdit}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
