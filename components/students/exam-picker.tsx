"use client";

import { useUrlFilters } from "@/components/admin/url-filters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Exam = { id: string; name: string; batchId: string; examDate: string | null };

/** Choose a batch, then one of its exams. Both live in the URL. */
export function ExamPicker({ batches, exams, batchId, examId }: { batches: { id: string; name: string }[]; exams: Exam[]; batchId: string; examId: string }) {
  const { setParams, pending } = useUrlFilters();
  const batchExams = exams.filter((e) => e.batchId === batchId);
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2 sm:max-w-xl", pending && "opacity-70")}>
      <Select value={batchId || undefined} onValueChange={(v) => setParams({ batch: v, exam: null })}>
        <SelectTrigger aria-label="Batch" className="w-full">
          <SelectValue placeholder="Choose a batch" />
        </SelectTrigger>
        <SelectContent>
          {batches.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={examId || undefined} onValueChange={(v) => setParams({ batch: batchId, exam: v })} disabled={!batchId}>
        <SelectTrigger aria-label="Exam" className="w-full">
          <SelectValue placeholder={batchExams.length ? "Choose an exam" : "No exams in this batch"} />
        </SelectTrigger>
        <SelectContent>
          {batchExams.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
