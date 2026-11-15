// Concession students: labels and the "ready to verify" check. Pure, so the
// browser and the server share it. The database has the same check in
// public.concession_missing() and refuses to verify without it.

import type { ConcessionCard, ConcessionRelationship, ConcessionStatus } from "@/lib/supabase/database.types";

export const CARD_TYPES: ConcessionCard[] = ["free", "half", "paid"];
export const STATUSES: ConcessionStatus[] = ["applied", "verified", "under_review", "ended"];

export const CARD_LABEL: Record<ConcessionCard, string> = { free: "Free card", half: "Half card", paid: "Paid card" };
export const CARD_HINT: Record<ConcessionCard, string> = {
  free: "Pays nothing",
  half: "Pays half the fee",
  paid: "Pays a monthly amount they can afford",
};
export const STATUS_LABEL: Record<ConcessionStatus, string> = {
  applied: "Applied",
  verified: "Verified",
  under_review: "Under review",
  ended: "Ended",
};
export const STATUS_BADGE: Record<ConcessionStatus, "warning" | "success" | "destructive" | "secondary"> = {
  applied: "warning",
  verified: "success",
  under_review: "destructive",
  ended: "secondary",
};
export const RELATIONSHIP_LABEL: Record<ConcessionRelationship, string> = {
  mother: "Mother",
  father: "Father",
  guardian: "Guardian",
};

/** The day 12 months before `day` ("YYYY-MM-DD"), as Postgres counts it (29 Feb → 28 Feb). */
export function twelveMonthsBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export type VerifyInput = {
  card: ConcessionCard;
  files: number;
  guardians: number;
  gnDivision: string;
  certificateIssuedOn: string | null;
  consentOn: string | null;
  monthlyAmount: number | null;
  /** Today in Sri Lanka, "YYYY-MM-DD". */
  today: string;
};

/** What is still needed before the student can be verified (empty = ready). Same order as the database. */
export function missingItems(i: VerifyInput): string[] {
  const out: string[] = [];
  if (i.files === 0) out.push("GN certificate file");
  if (!i.gnDivision) out.push("GN division");
  if (!i.certificateIssuedOn) out.push("Certificate date");
  else if (i.certificateIssuedOn < twelveMonthsBefore(i.today)) out.push("A certificate from the last 12 months");
  if (i.guardians === 0) out.push("Parent occupation");
  if (!i.consentOn) out.push("Parents' consent");
  if (i.card !== "free" && i.monthlyAmount === null) out.push("Monthly amount");
  return out;
}

export const ATTENDANCE_LABEL = { present: "Present", absent: "Absent", excused: "Excused" } as const;
export type Attendance = keyof typeof ATTENDANCE_LABEL;

/** Below this percentage a result is shown as low. */
export const LOW_PERCENT = 35;

/**
 * Total of a student's part marks. `complete` is false while a part has no
 * mark yet; the percentage is out of the full exam either way.
 */
export function resultTotal(parts: { id: string; maxMarks: number }[], marks: Record<string, number | null | undefined>) {
  const max = parts.reduce((sum, p) => sum + p.maxMarks, 0);
  const given = parts.filter((p) => marks[p.id] !== null && marks[p.id] !== undefined);
  if (given.length === 0) return { total: null, max, percent: null, complete: false };
  const total = Math.round(given.reduce((sum, p) => sum + Number(marks[p.id]), 0) * 100) / 100;
  return { total, max, percent: max > 0 ? Math.round((total / max) * 1000) / 10 : null, complete: given.length === parts.length };
}
