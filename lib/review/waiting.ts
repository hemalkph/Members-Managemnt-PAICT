// How long a piece of work has waited for review.

/** Waiting starts when the work was sent, or sent again after a send-back. */
export function waitingSince(row: { created_at: string; resubmitted_at?: string | null }): string {
  return row.resubmitted_at ?? row.created_at;
}

/** Whole hours waited (never negative). */
export function waitingHours(sinceIso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(sinceIso)) / 3_600_000));
}

/** "under 1 h", "30 h", "3 d". */
export function waitingText(hours: number): string {
  if (hours < 1) return "under 1 h";
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function isOverLimit(hours: number, limit: number): boolean {
  return hours >= limit;
}
