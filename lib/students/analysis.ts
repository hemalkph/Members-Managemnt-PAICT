import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { shiftMonth, todayISO } from "@/lib/core/month";
import { allRows } from "@/lib/supabase/all-rows";
import type { Database } from "@/lib/supabase/database.types";
import { autoFlags, type AutoFlag, type ManualFlagKind, type StudentFacts } from "@/lib/students/flags";
import { getConcessionStudents, type StudentRow } from "@/lib/students/queries";
import type { Attendance } from "@/lib/students/rules";

type Client = SupabaseClient<Database>;

/** The last day of a calendar month "YYYY-MM". */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Today's calendar month in Sri Lanka. */
export function thisCalendarMonth(): string {
  return todayISO().slice(0, 7);
}

export type MonthStats = {
  /** Exams of the student's batch held this month (dated today or earlier). */
  held: number;
  present: number;
  absent: number;
  excused: number;
  /** Average % of the exams they sat with marks. */
  averagePercent: number | null;
};

export type ManualFlag = { id: string; kind: ManualFlagKind; reason: string; raisedAt: string };

export type AnalysisRow = StudentRow & {
  flags: AutoFlag[];
  manualFlags: ManualFlag[];
  stats: MonthStats;
  payment: "paid" | "unpaid" | null;
  /** A Half / Paid card verified by the end of the month: a payment is expected. */
  paymentDue: boolean;
};

type Totals = Database["public"]["Functions"]["concession_result_totals"]["Returns"][number];

/** A result's percentage of the whole exam, or null without marks. */
export function percentOf(t: Pick<Totals, "attendance" | "total" | "max_total" | "parts_marked">): number | null {
  if (t.attendance !== "present" || !t.parts_marked || !t.max_total || t.total === null) return null;
  return Math.round((Number(t.total) / Number(t.max_total)) * 1000) / 10;
}

export function statsFor(exams: { id: string; date: string }[], results: StudentFacts["results"], month: string, today: string): MonthStats {
  const held = exams.filter((e) => e.date.startsWith(month) && e.date <= today);
  const got = held.map((e) => results[e.id]).filter((r) => r !== undefined);
  const pcts = got.map((r) => r.percent).filter((p): p is number => p !== null);
  return {
    held: held.length,
    present: got.filter((r) => r.attendance === "present").length,
    absent: got.filter((r) => r.attendance === "absent").length,
    excused: got.filter((r) => r.attendance === "excused").length,
    averagePercent: pcts.length ? Math.round((pcts.reduce((s, p) => s + p, 0) / pcts.length) * 10) / 10 : null,
  };
}

/** The first month each student was verified. */
async function verifiedMonths(supabase: Client, studentId?: string): Promise<Map<string, string>> {
  const rows = await allRows((a, b) => {
    let q = supabase.from("concession_card_history").select("student_id, changed_at").eq("status", "verified");
    if (studentId) q = q.eq("student_id", studentId);
    return q.order("changed_at").order("id").range(a, b);
  });
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.student_id)) out.set(r.student_id, r.changed_at.slice(0, 7));
  return out;
}

/** Exams with a date between two days, oldest first, grouped by batch. */
async function examsByBatch(supabase: Client, from: string, to: string) {
  const exams = await allRows((a, b) =>
    supabase
      .from("exams")
      .select("id, name, batch_id, exam_date")
      .gte("exam_date", from)
      .lte("exam_date", to)
      .order("exam_date")
      .order("id")
      .range(a, b),
  );
  const byBatch = new Map<string, { id: string; name: string; date: string }[]>();
  for (const e of exams) {
    if (!e.exam_date) continue;
    byBatch.set(e.batch_id, [...(byBatch.get(e.batch_id) ?? []), { id: e.id, name: e.name, date: e.exam_date }]);
  }
  return byBatch;
}

/**
 * Everything the analysis page needs for one calendar month: each student
 * with their automatic and manual flags, exam figures and payment.
 * Looks back 6 months for "absent twice in a row" and the 3-month average.
 */
export async function getMonthAnalysis(supabase: Client, month: string): Promise<AnalysisRow[]> {
  const today = todayISO();
  const from = `${shiftMonth(month, -6)}-01`;
  const to = monthEnd(month);
  const [students, verified, byBatch, totals, payments, flags] = await Promise.all([
    getConcessionStudents(supabase),
    verifiedMonths(supabase),
    examsByBatch(supabase, from, to),
    allRows((a, b) => supabase.rpc("concession_result_totals", { p_from: from, p_to: to }).range(a, b)),
    allRows((a, b) =>
      supabase
        .from("concession_payments")
        .select("student_id, month, status")
        .gte("month", `${shiftMonth(month, -2)}-01`)
        .lte("month", `${month}-01`)
        .order("student_id")
        .order("month")
        .range(a, b),
    ),
    allRows((a, b) =>
      supabase
        .from("concession_flags")
        .select("id, student_id, kind, reason, raised_at")
        .is("resolved_at", null)
        .order("raised_at", { ascending: false })
        .order("id")
        .range(a, b),
    ),
  ]);

  const resultsOf = new Map<string, StudentFacts["results"]>();
  for (const t of totals) {
    resultsOf.set(t.student_id, {
      ...resultsOf.get(t.student_id),
      [t.exam_id]: { attendance: t.attendance as Attendance, percent: percentOf(t) },
    });
  }
  const paymentsOf = new Map<string, StudentFacts["payments"]>();
  for (const p of payments) {
    paymentsOf.set(p.student_id, { ...paymentsOf.get(p.student_id), [p.month.slice(0, 7)]: p.status });
  }
  const flagsOf = new Map<string, ManualFlag[]>();
  for (const f of flags) {
    flagsOf.set(f.student_id, [...(flagsOf.get(f.student_id) ?? []), { id: f.id, kind: f.kind, reason: f.reason, raisedAt: f.raised_at }]);
  }

  return students.map((s) => {
    const exams = byBatch.get(s.batchId) ?? [];
    const results = resultsOf.get(s.id) ?? {};
    const pays = paymentsOf.get(s.id) ?? {};
    const verifiedMonth = verified.get(s.id) ?? null;
    return {
      ...s,
      flags: autoFlags(
        { card: s.card, status: s.status, createdOn: s.createdAt.slice(0, 10), verifiedMonth, missing: s.missing, exams, results, payments: pays },
        month,
        today,
      ),
      manualFlags: flagsOf.get(s.id) ?? [],
      stats: statsFor(exams, results, month, today),
      payment: pays[month] ?? null,
      paymentDue: s.card !== "free" && s.status !== "ended" && verifiedMonth !== null && verifiedMonth <= month,
    };
  });
}

export type TimelineMonth = MonthStats & { month: string; payment: "paid" | "unpaid" | null; amount: number | null };
export type TimelineExam = {
  id: string;
  name: string;
  date: string;
  attendance: Attendance | null;
  total: number | null;
  max: number | null;
  percent: number | null;
};

/** One student's last 12 months: exam figures, payments and each exam's result, newest first. */
export async function getStudentTimeline(
  supabase: Client,
  student: Pick<StudentRow, "id" | "batchId" | "card" | "status" | "createdAt" | "missing">,
) {
  const today = todayISO();
  const last = thisCalendarMonth();
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(last, -i));
  const from = `${shiftMonth(last, -11)}-01`;
  const [verified, byBatch, totals, { data: payments }] = await Promise.all([
    verifiedMonths(supabase, student.id),
    examsByBatch(supabase, `${shiftMonth(last, -17)}-01`, today),
    allRows((a, b) => supabase.rpc("concession_result_totals", { p_from: `${shiftMonth(last, -17)}-01`, p_to: today, p_student: student.id }).range(a, b)),
    supabase.from("concession_payments").select("month, status, amount").eq("student_id", student.id).gte("month", from),
  ]);

  const exams = byBatch.get(student.batchId) ?? [];
  const totalOf = new Map(totals.map((t) => [t.exam_id, t]));
  const results: StudentFacts["results"] = Object.fromEntries(
    totals.map((t) => [t.exam_id, { attendance: t.attendance as Attendance, percent: percentOf(t) }]),
  );
  const payOf = new Map((payments ?? []).map((p) => [p.month.slice(0, 7), p]));
  const verifiedMonth = verified.get(student.id) ?? null;

  return {
    flags: autoFlags(
      {
        card: student.card,
        status: student.status,
        createdOn: student.createdAt.slice(0, 10),
        verifiedMonth,
        missing: student.missing,
        exams,
        results,
        payments: Object.fromEntries([...payOf].map(([m, p]) => [m, p.status])),
      },
      last,
      today,
    ),
    verifiedMonth,
    months: months.map(
      (m): TimelineMonth => ({
        month: m,
        ...statsFor(exams, results, m, today),
        payment: payOf.get(m)?.status ?? null,
        amount: payOf.get(m)?.amount ?? null,
      }),
    ),
    exams: exams
      .filter((e) => e.date >= from)
      .reverse()
      .map((e): TimelineExam => {
        const t = totalOf.get(e.id);
        return {
          id: e.id,
          name: e.name,
          date: e.date,
          attendance: (t?.attendance as Attendance | undefined) ?? null,
          total: t?.total === null || t?.total === undefined ? null : Number(t.total),
          max: t?.max_total === null || t?.max_total === undefined ? null : Number(t.max_total),
          percent: t ? percentOf(t) : null,
        };
      }),
  };
}
