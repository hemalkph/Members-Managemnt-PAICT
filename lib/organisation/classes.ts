import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type BatchOption = { id: string; name: string; isActive: boolean; sortOrder: number };
export type ExamOption = {
  id: string;
  name: string;
  batchId: string;
  batchName: string;
  examDate: string | null;
  isActive: boolean;
  /** The series it belongs to ("Ranking Full Papers"), and its number in it. */
  seriesId: string | null;
  number: number | null;
  /** "2026 A/L – Term Test 2" */
  label: string;
};
export type SeriesOption = {
  id: string;
  batchId: string;
  name: string;
  code: string;
  defaultParts: { name: string; max_marks: number }[];
  isActive: boolean;
};
export type CentreOption = { id: string; name: string; isActive: boolean; sortOrder: number };
export type ClassOptions = { batches: BatchOption[]; series: SeriesOption[]; exams: ExamOption[]; centres: CentreOption[] };

/** Batches, exam series, exams and centres (all, including inactive ones). */
export async function getClassOptions(supabase: SupabaseClient<Database>): Promise<ClassOptions> {
  const [{ data: batches }, { data: series }, { data: exams }, { data: centres }] = await Promise.all([
    supabase.from("batches").select("id, name, is_active, sort_order").order("sort_order").order("name"),
    supabase.from("exam_series").select("id, batch_id, name, code, default_parts, is_active").order("name"),
    supabase
      .from("exams")
      .select("id, name, batch_id, exam_date, is_active, series_id, number, created_at")
      .order("exam_date", { ascending: true, nullsFirst: false })
      .order("created_at"),
    supabase.from("centres").select("id, name, is_active, sort_order").order("sort_order").order("name"),
  ]);
  const batchList = (batches ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    isActive: b.is_active,
    sortOrder: b.sort_order,
  }));
  const batchName = new Map(batchList.map((b) => [b.id, b.name]));
  return {
    batches: batchList,
    series: (series ?? []).map((x) => ({
      id: x.id,
      batchId: x.batch_id,
      name: x.name,
      code: x.code,
      defaultParts: x.default_parts ?? [],
      isActive: x.is_active,
    })),
    exams: (exams ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      batchId: e.batch_id,
      batchName: batchName.get(e.batch_id) ?? "",
      examDate: e.exam_date,
      isActive: e.is_active,
      seriesId: e.series_id,
      number: e.number,
      label: `${batchName.get(e.batch_id) ?? ""} – ${e.name}`,
    })),
    centres: (centres ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      isActive: c.is_active,
      sortOrder: c.sort_order,
    })),
  };
}

/** Only active options, for forms (keeps a currently selected inactive one). */
export function activeOptions(options: ClassOptions, keep: { examId?: string | null; centreId?: string | null } = {}) {
  const activeBatch = new Set(options.batches.filter((b) => b.isActive).map((b) => b.id));
  return {
    exams: options.exams.filter((e) => (e.isActive && activeBatch.has(e.batchId)) || e.id === keep.examId),
    centres: options.centres.filter((c) => c.isActive || c.id === keep.centreId),
  };
}
