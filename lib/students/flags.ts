// Automatic flags for concession students, worked out from the data each time
// (never stored, so never out of date). Pure, so it is unit-tested.
// Months are calendar months "YYYY-MM"; days are "YYYY-MM-DD" in Sri Lanka.

import { shiftMonth } from "@/lib/core/month";
import type { ConcessionCard, ConcessionStatus } from "@/lib/supabase/database.types";
import { CERTIFICATE_REMIND_DAYS, certificateValidUntil, LOW_PERCENT, type Attendance } from "@/lib/students/rules";

export type FlagLevel = "red" | "orange" | "yellow";
export type AutoFlag = { key: string; level: FlagLevel; label: string };

/** How far below the student's 3-month average counts as a drop. */
export const DROP_POINTS = 15;
/** Days after registration before a missing certificate or occupation is flagged. */
export const MISSING_GRACE_DAYS = 14;

export type StudentFacts = {
  card: ConcessionCard;
  status: ConcessionStatus;
  /** Registration day. */
  createdOn: string;
  /** The month the student was first verified (payments are expected from then). */
  verifiedMonth: string | null;
  /** What is still needed before verifying (lib/students/rules missingItems). */
  missing: string[];
  certificateIssuedOn: string | null;
  /** Exams of the student's batch with a date, oldest first. */
  exams: { id: string; date: string }[];
  /** exam id -> the student's result (percent is null when no marks). */
  results: Record<string, { attendance: Attendance; percent: number | null }>;
  /** month -> payment status. */
  payments: Record<string, "paid" | "unpaid">;
};

const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const round = (n: number) => Math.round(n * 10) / 10;

/** The flags of one student for `month`, most serious first. */
export function autoFlags(f: StudentFacts, month: string, today: string): AutoFlag[] {
  if (f.status === "ended") return [];
  const out: AutoFlag[] = [];
  const thisMonth = today.slice(0, 7);
  const monthEnd = month < thisMonth ? `${month}-31` : today;

  // Paperwork
  if (
    (f.missing.includes("GN certificate file") || f.missing.includes("Parent occupation")) &&
    daysBetween(f.createdOn, today) >= MISSING_GRACE_DAYS
  ) {
    out.push({ key: "paperwork", level: "red", label: `Certificate or parent occupation missing for ${MISSING_GRACE_DAYS}+ days` });
  }

  // Attendance
  const held = f.exams.filter((e) => e.date <= monthEnd);
  const inMonth = held.filter((e) => e.date.startsWith(month));
  const absentInMonth = inMonth.filter((e) => f.results[e.id]?.attendance === "absent").length;
  const lastTwo = held.slice(-2);
  if (absentInMonth >= 2) {
    out.push({ key: "absent", level: "red", label: `Absent from ${plural(absentInMonth, "exam")} this month` });
  } else if (lastTwo.length === 2 && lastTwo.every((e) => f.results[e.id]?.attendance === "absent")) {
    out.push({ key: "absent", level: "red", label: "Absent from 2 exams in a row" });
  }

  // Payments: the last two finished months, from the month they were verified.
  if (f.card !== "free" && f.verifiedMonth) {
    const last = month < thisMonth ? month : shiftMonth(thisMonth, -1);
    const months = [shiftMonth(last, -1), last];
    if (months.every((m) => m >= f.verifiedMonth! && f.payments[m] !== "paid")) {
      out.push({ key: "unpaid", level: "red", label: "Not paid for 2 months in a row" });
    }
  }

  // Marks: the latest exam of the month with marks.
  const marked = inMonth.filter((e) => f.results[e.id]?.attendance === "present" && f.results[e.id]?.percent !== null);
  const latest = marked.at(-1);
  if (latest) {
    const pct = f.results[latest.id].percent!;
    const before = f.exams.filter((e) => e.date >= `${shiftMonth(month, -3)}-01` && e.date < `${month}-01`);
    const past = before.map((e) => f.results[e.id]).filter((r) => r?.attendance === "present" && r.percent !== null);
    const average = past.length ? past.reduce((s, r) => s + r!.percent!, 0) / past.length : null;
    if (pct < LOW_PERCENT) {
      out.push({ key: "low", level: "orange", label: `Below ${LOW_PERCENT}% in the latest exam (${round(pct)}%)` });
    } else if (average !== null && pct <= average - DROP_POINTS) {
      out.push({ key: "drop", level: "orange", label: `Marks dropped ${round(average - pct)} points below their 3-month average` });
    }
  }

  if (f.missing.includes("A certificate from the last 12 months")) {
    out.push({ key: "old-certificate", level: "orange", label: "GN certificate older than 12 months" });
  } else if (f.certificateIssuedOn) {
    const until = certificateValidUntil(f.certificateIssuedOn);
    const left = daysBetween(today, until);
    if (left >= 0 && left <= CERTIFICATE_REMIND_DAYS) {
      out.push({ key: "certificate-soon", level: "yellow", label: `GN certificate runs out in ${plural(left, "day")}` });
    }
  }

  // Exams before they registered don't count.
  const noResult = inMonth.filter((e) => !f.results[e.id] && e.date >= f.createdOn).length;
  if (noResult > 0) {
    out.push({ key: "no-result", level: "yellow", label: `No result entered for ${plural(noResult, "exam")} this month` });
  }
  return out;
}

export const FLAG_BADGE: Record<FlagLevel, "destructive" | "warning" | "secondary"> = {
  red: "destructive",
  orange: "warning",
  yellow: "secondary",
};

export const MANUAL_FLAG_LABEL = { needs_review: "Needs review", warning: "Warning", top: "Top performer" } as const;
export type ManualFlagKind = keyof typeof MANUAL_FLAG_LABEL;

/** A flag an admin raised, as the student page shows it. */
export type FlagView = {
  id: string;
  kind: ManualFlagKind;
  reason: string;
  raisedAt: string;
  raisedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolveNote: string;
};
