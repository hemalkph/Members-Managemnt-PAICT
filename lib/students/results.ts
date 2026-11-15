import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConcessionAttendance, ConcessionCard, Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type ExamPart = { id: string; name: string; maxMarks: number; sortOrder: number };
export type SheetRow = {
  studentId: string;
  studentNo: string;
  fullName: string;
  card: ConcessionCard;
  centreId: string | null;
  attendance: ConcessionAttendance | null;
  note: string;
  /** part id -> marks */
  marks: Record<string, number>;
};

export async function getExamParts(supabase: Client, examId: string): Promise<ExamPart[]> {
  const { data } = await supabase
    .from("exam_parts")
    .select("id, name, max_marks, sort_order")
    .eq("exam_id", examId)
    .order("sort_order")
    .order("created_at");
  return (data ?? []).map((p) => ({ id: p.id, name: p.name, maxMarks: Number(p.max_marks), sortOrder: p.sort_order }));
}

/**
 * The results sheet of one exam: the batch's concession students (names and
 * card type only, through concession_roster) with their attendance and marks.
 */
export async function getExamSheet(supabase: Client, examId: string): Promise<{ parts: ExamPart[]; rows: SheetRow[] }> {
  const [parts, { data: roster }, { data: results }] = await Promise.all([
    getExamParts(supabase, examId),
    supabase.rpc("concession_roster", { p_exam: examId }),
    supabase.from("concession_results").select("id, student_id, attendance, note").eq("exam_id", examId),
  ]);
  const resultIds = (results ?? []).map((r) => r.id);
  const { data: marks } = resultIds.length
    ? await supabase.from("concession_part_marks").select("result_id, part_id, marks").in("result_id", resultIds)
    : { data: [] };

  const marksOf = new Map<string, Record<string, number>>();
  for (const m of marks ?? []) marksOf.set(m.result_id, { ...marksOf.get(m.result_id), [m.part_id]: Number(m.marks) });
  const resultOf = new Map((results ?? []).map((r) => [r.student_id, r]));

  return {
    parts,
    rows: (roster ?? []).map((s) => {
      const r = resultOf.get(s.student_id);
      return {
        studentId: s.student_id,
        studentNo: s.student_no,
        fullName: s.full_name,
        card: s.card_type,
        centreId: s.centre_id,
        attendance: r?.attendance ?? null,
        note: r?.note ?? "",
        marks: (r && marksOf.get(r.id)) ?? {},
      };
    }),
  };
}
