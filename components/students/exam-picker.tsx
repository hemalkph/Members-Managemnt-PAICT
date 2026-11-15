"use client";

import { useUrlFilters } from "@/components/admin/url-filters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { groupExams } from "@/lib/organisation/exam-groups";
import { cn } from "@/lib/utils";

type Exam = { id: string; name: string; batchId: string; seriesId: string | null; number: number | null };
type Series = { id: string; batchId: string; name: string; code: string };
const OTHER = "other";

/** Choose a batch, then a series (e.g. Ranking Full Papers), then its exam (RFP 05). All live in the URL. */
export function ExamPicker({
  batches,
  series,
  exams,
  batchId,
  examId,
  seriesKey,
}: {
  batches: { id: string; name: string }[];
  series: Series[];
  exams: Exam[];
  batchId: string;
  examId: string;
  /** The chosen series id, or "other" for exams without a series. */
  seriesKey: string;
}) {
  const { setParams, pending } = useUrlFilters();
  const groups = groupExams(batchId, series, exams);
  const group =
    groups.find((g) => (g.seriesId ?? OTHER) === seriesKey) ?? (groups.length === 1 ? groups[0] : undefined);
  const groupKey = group ? (group.seriesId ?? OTHER) : "";

  return (
    <div className={cn("grid gap-2 sm:max-w-3xl sm:grid-cols-3", pending && "opacity-70")}>
      <Select value={batchId || undefined} onValueChange={(v) => setParams({ batch: v, series: null, exam: null })}>
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
      <Select
        value={groupKey || undefined}
        onValueChange={(v) => setParams({ batch: batchId, series: v, exam: null })}
        disabled={!batchId || groups.length === 0}
      >
        <SelectTrigger aria-label="Series" className="w-full">
          <SelectValue placeholder={groups.length ? "Choose a series" : "No exams in this batch"} />
        </SelectTrigger>
        <SelectContent>
          {groups.map((g) => (
            <SelectItem key={g.seriesId ?? OTHER} value={g.seriesId ?? OTHER}>
              {g.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={examId || undefined}
        onValueChange={(v) => setParams({ batch: batchId, series: groupKey, exam: v })}
        disabled={!group}
      >
        <SelectTrigger aria-label="Exam" className="w-full">
          <SelectValue placeholder={group?.exams.length === 0 ? "No exams yet" : "Choose an exam"} />
        </SelectTrigger>
        <SelectContent>
          {[...(group?.exams ?? [])].reverse().map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
