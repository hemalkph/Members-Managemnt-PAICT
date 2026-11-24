const DAY_MS = 86_400_000;

/** Percentage of planned students who have paid so far (clamped 0–100). */
export function paidProgressPct(paid: number | null, expected: number): number {
  if (paid === null || expected <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((paid / expected) * 100)));
}

/**
 * Whether an active class's paid count needs an update in the current month:
 * missing altogether, or last updated more than `staleDays` ago (default 5 days).
 */
export function isPaidCountStale(
  paidAt: string | null,
  isThisMonth: boolean,
  nowMs = Date.now(),
  staleDays = 5,
): boolean {
  if (!isThisMonth) return false;
  if (!paidAt) return true;
  const parsed = Date.parse(paidAt);
  if (Number.isNaN(parsed)) return true;
  return nowMs - parsed > staleDays * DAY_MS;
}

/**
 * Guardrail for accidental typos when typing "Paid today…":
 * warns if lower than the current paid count or more than 2× last month.
 */
export function checkPaidCountWarning(
  typed: number,
  currentPaid: number | null,
  lastMonth: number | null,
): string | null {
  if (currentPaid !== null && typed < currentPaid) {
    return `Lower than current ${currentPaid} — click Save again to confirm`;
  }
  if (lastMonth !== null && lastMonth >= 10 && typed > lastMonth * 2) {
    return `More than 2× last month (${lastMonth}) — click Save again to confirm`;
  }
  return null;
}

/** Dedupe and filter out (classId, tuteId) pairs that are already scheduled. */
export function filterNewTutePairs(
  classIds: string[],
  tuteIds: string[],
  existingKeys: ReadonlySet<string>,
): { classId: string; tuteId: string }[] {
  const uniqueClasses = [...new Set(classIds)];
  const uniqueTutes = [...new Set(tuteIds)];
  const out: { classId: string; tuteId: string }[] = [];
  for (const classId of uniqueClasses) {
    for (const tuteId of uniqueTutes) {
      if (!existingKeys.has(`${classId}:${tuteId}`)) {
        out.push({ classId, tuteId });
      }
    }
  }
  return out;
}
