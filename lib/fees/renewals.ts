// Renewal rules: who needs a phone call, the target line, students who moved
// class, and one class card's numbers. Pure, so the page and tests share them.
// The call rule matches public.followup_needs_call (migration 078).
import type { ComparedStudent, FeeComparisonResult, MonthStudentRow } from "@/lib/fees/compare";
import { areNamesCompatible } from "@/lib/fees/parse-sheet";
import type { FeeFollowupStatus } from "@/lib/supabase/database.types";

/** Outcomes that end the chase: no more reminders or calls. */
export const CLOSED_STATUSES: FeeFollowupStatus[] = ["excused", "dropped", "cant_afford", "moved_class"];

export function isClosedFollowup(status: FeeFollowupStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

export type DropReason = "exams" | "money" | "moved_away" | "timing" | "other_institute" | "other";

export const DROP_REASONS: { code: DropReason; label: string }[] = [
  { code: "exams", label: "Exams" },
  { code: "money", label: "Money" },
  { code: "moved_away", label: "Moved away" },
  { code: "timing", label: "Class time" },
  { code: "other_institute", label: "Another institute" },
  { code: "other", label: "Other" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Two reminders, two days, still unpaid (or a promise that has passed), and no call in the last day. */
export function needsCall(
  row: Pick<
    ComparedStudent,
    "kind" | "followupStatus" | "messageCount" | "lastMessagedAt" | "lastCalledAt" | "promisedBy"
  >,
  now: Date,
  today: string,
): boolean {
  if (row.kind !== "due" || isClosedFollowup(row.followupStatus)) return false;
  const nowMs = now.getTime();
  if (row.lastCalledAt && Date.parse(row.lastCalledAt) > nowMs - DAY_MS) return false;
  if (row.followupStatus === "messaged") {
    return (
      row.messageCount >= 2 && Boolean(row.lastMessagedAt) && Date.parse(row.lastMessagedAt!) <= nowMs - 2 * DAY_MS
    );
  }
  if (row.followupStatus === "promised") return Boolean(row.promisedBy) && row.promisedBy! < today;
  return false;
}

/** The "should have renewed by now" line: 0% on day 1, rising to the target on the due day, flat after. */
export function targetShare(day: number, dueDay: number, targetPct: number): number {
  if (day >= dueDay || dueDay <= 1) return targetPct;
  return (targetPct * (day - 1)) / (dueDay - 1);
}

const normName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** An unpaid student found on another class's list this month (by phone with a matching name, or exact name). */
export function findMovedClass(
  student: Pick<ComparedStudent, "fullName" | "whatsappNorm" | "mobileNorm">,
  others: { classId: string; className: string; students: MonthStudentRow[] }[],
): { classId: string; className: string } | null {
  const phones = [student.whatsappNorm, student.mobileNorm].filter((p): p is string => Boolean(p));
  for (const other of others) {
    const hit = other.students.some(
      (s) =>
        [s.whatsappNorm, s.mobileNorm].some((p) => p && phones.includes(p)) &&
        areNamesCompatible(student.fullName, s.fullName),
    );
    if (hit) return { classId: other.classId, className: other.className };
  }
  const name = normName(student.fullName);
  if (name.length < 5) return null;
  for (const other of others) {
    if (other.students.some((s) => normName(s.fullName) === name))
      return { classId: other.classId, className: other.className };
  }
  return null;
}

export type RenewalCard = {
  classId: string;
  className: string;
  batchName: string;
  prevTotal: number;
  renewed: number;
  renewedPct: number | null;
  fresh: number;
  unpaid: number;
  /** Unpaid and still being chased (not excused, dropped, can't afford or moved). */
  open: number;
  outcomes: Partial<Record<FeeFollowupStatus, number>>;
  callList: ComparedStudent[];
  /** open × class fee; null when the class has no fee (or money isn't shown). */
  moneyAtRisk: number | null;
};

export function buildRenewalCard(input: {
  classId: string;
  className: string;
  batchName: string;
  result: FeeComparisonResult;
  fee: number | null;
  now: Date;
  today: string;
}): RenewalCard {
  const { result, fee, now, today } = input;
  const dueRows = result.rows.filter((r) => r.kind === "due");
  const outcomes: Partial<Record<FeeFollowupStatus, number>> = {};
  for (const r of dueRows) outcomes[r.followupStatus] = (outcomes[r.followupStatus] ?? 0) + 1;
  const open = dueRows.filter((r) => !isClosedFollowup(r.followupStatus)).length;
  const prevTotal = result.summary.prevCount;
  const renewed = result.summary.paidBothCount;

  return {
    classId: input.classId,
    className: input.className,
    batchName: input.batchName,
    prevTotal,
    renewed,
    renewedPct: prevTotal > 0 ? Math.round((renewed / prevTotal) * 100) : null,
    fresh: result.summary.newCount,
    unpaid: dueRows.length,
    open,
    outcomes,
    callList: dueRows
      .filter((r) => needsCall(r, now, today))
      .sort((a, b) => (a.lastMessagedAt ?? "").localeCompare(b.lastMessagedAt ?? "")),
    moneyAtRisk: fee === null ? null : open * fee,
  };
}

/**
 * Whether a student belongs in the WhatsApp reminder queue. Messaged students and
 * students who promised to pay only come back when "include messaged" is on (or their
 * number changed), so a reminder never overwrites a promise by accident.
 */
export function inReminderQueue(
  row: Pick<ComparedStudent, "kind" | "followupStatus" | "contactPhoneChanged">,
  includeMessaged: boolean,
): boolean {
  if (row.kind !== "due" || isClosedFollowup(row.followupStatus)) return false;
  const chased = row.followupStatus === "messaged" || row.followupStatus === "promised";
  return !chased || includeMessaged || row.contactPhoneChanged;
}
