// Exams grouped under their series for pickers and lists. Pure (browser + server).

type SeriesLike = { id: string; batchId: string; name: string; code: string };
type ExamLike = { id: string; batchId: string; seriesId: string | null; number: number | null; name: string };

export type ExamGroup<E> = { seriesId: string | null; label: string; exams: E[] };

/** One batch's exams: each series (in number order), then the exams without a series. */
export function groupExams<E extends ExamLike>(batchId: string, series: SeriesLike[], exams: E[]): ExamGroup<E>[] {
  const mine = exams.filter((e) => e.batchId === batchId);
  const groups: ExamGroup<E>[] = series
    .filter((s) => s.batchId === batchId)
    .map((s) => ({
      seriesId: s.id,
      label: `${s.name} (${s.code})`,
      exams: mine.filter((e) => e.seriesId === s.id).sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
    }));
  const other = mine.filter((e) => !e.seriesId || !groups.some((g) => g.seriesId === e.seriesId));
  if (other.length) groups.push({ seriesId: null, label: "Other exams", exams: other });
  return groups;
}
