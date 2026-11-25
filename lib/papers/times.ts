// Stage times (Sri Lanka): the paper's work window, the pre-exam stages
// stretched to fill it in their usual shape, and the countdown text.
import { addDays, PRE_EXAM_STAGES, stageOffsets, type StageOffsets } from "@/lib/papers";
import type { PaperStageName } from "@/lib/supabase/database.types";

export type StageTimes = Partial<Record<PaperStageName, { startAt: string; dueAt: string }>>;

const HOUR = 3_600_000;
const OFFSET_MS = 5.5 * HOUR; // Asia/Colombo has no daylight saving.

/** "2026-12-04" + "18:30" → "2026-12-04T18:30:00+05:30". */
export function toColomboISO(date: string, time: string): string {
  return `${date}T${time.slice(0, 5)}:00+05:30`;
}

/** Any ISO time → its Sri Lanka date and "HH:MM". */
export function fromColomboISO(iso: string): { date: string; time: string } {
  const local = new Date(Date.parse(iso) + OFFSET_MS).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

const toISO = (ms: number) => {
  const { date, time } = fromColomboISO(new Date(ms).toISOString());
  return toColomboISO(date, time);
};

/** Round to the nearest whole hour on the Sri Lanka clock. */
const roundHour = (ms: number) => Math.round((ms + OFFSET_MS) / HOUR) * HOUR - OFFSET_MS;

/** 08:00 on Create's start day to 18:00 on Hand over's due day, from the exam day. */
export function defaultWindow(examDay: string, offsets: StageOffsets = {}): { start: string; end: string } {
  return {
    start: toColomboISO(addDays(examDay, stageOffsets("create_si", offsets).start), "08:00"),
    end: toColomboISO(addDays(examDay, stageOffsets("handover", offsets).due), "18:00"),
  };
}

export function windowError(start: string, end: string): string | null {
  return Date.parse(end) > Date.parse(start) ? null : "The hand-over deadline must be after the start.";
}

/**
 * Stretch the pre-exam stages' usual days (start of the start day → end of the due day) onto
 * [start, end], keeping their order and overlaps, rounded to the hour. Skipped stages are left out.
 */
export function stretchStages(
  start: string,
  end: string,
  skipped: PaperStageName[],
  offsets: StageOffsets = {},
): StageTimes {
  const stages = PRE_EXAM_STAGES.filter((s) => !skipped.includes(s));
  const o = Object.fromEntries(PRE_EXAM_STAGES.map((s) => [s, stageOffsets(s, offsets)])) as Record<
    PaperStageName,
    { start: number; due: number }
  >;
  const t0 = Math.min(...PRE_EXAM_STAGES.map((s) => o[s].start));
  const t1 = Math.max(...PRE_EXAM_STAGES.map((s) => o[s].due + 1));
  const s0 = Date.parse(start);
  const span = Date.parse(end) - s0;
  const at = (day: number) => s0 + ((day - t0) / (t1 - t0)) * span;

  const out: StageTimes = {};
  for (const s of stages) {
    const a = roundHour(at(o[s].start));
    let b = roundHour(at(o[s].due + 1));
    if (b <= a) b = a + HOUR;
    out[s] = { startAt: toISO(a), dueAt: toISO(b) };
  }
  // The deadline is exact, not rounded.
  if (out.handover) out.handover.dueAt = toISO(Date.parse(end));
  return out;
}

/** When a stage is due: its time, else 23:59 on its due date (Sri Lanka). */
export function stageDeadline(dueAt: string | null, dueDate: string | null): number | null {
  if (dueAt) return Date.parse(dueAt);
  if (dueDate) return Date.parse(toColomboISO(dueDate, "23:59"));
  return null;
}

function span(msLeft: number): string {
  const mins = Math.floor(msLeft / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} m`;
  return `${m} m`;
}

/** "2 d 4 h left", "5 h 20 m left", "45 m left", or "Late 1 d 3 h". */
export function countdownText(deadlineMs: number, nowMs: number): { text: string; late: boolean } {
  const diff = deadlineMs - nowMs;
  return diff >= 0 ? { text: `${span(diff)} left`, late: false } : { text: `Late ${span(-diff)}`, late: true };
}
