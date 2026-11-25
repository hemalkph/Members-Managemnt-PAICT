// Exam countdown rules: is a paper ready, on track, at risk or late for its
// exam day, which stage holds it up, and which stage days to move earlier.
// Pure, so the page and the tests share them.
import {
  addDays,
  PRE_EXAM_STAGES,
  STAGE_LABEL,
  stageOffsets,
  type PaperView,
  type StageOffsets,
  type StageView,
} from "@/lib/papers";
import type { PaperStageName } from "@/lib/supabase/database.types";
import { awayBetween, type DayOff } from "@/lib/team/availability";

export type StageStat = { stage: PaperStageName; done: number; late: number; avgDaysLate: number; medianDays: number };
export type PaperState = "ready" | "late" | "at_risk" | "on_track";

export type CountdownRow = {
  paper: PaperView;
  examDay: string;
  state: PaperState;
  blocking: StageView | null;
  daysLate: number;
  reason: string;
};

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** A timestamp's Sri Lanka date. */
const colomboDay = (ts: string) => new Date(Date.parse(ts) + 5.5 * 3_600_000).toISOString().slice(0, 10);

export function paperCountdown(
  paper: PaperView,
  examDay: string,
  today: string,
  stats: StageStat[],
  daysOff: DayOff[],
): CountdownRow {
  const base = { paper, examDay };
  const pre = paper.stages
    .filter((s) => PRE_EXAM_STAGES.includes(s.stage) && s.status !== "skipped")
    .sort((a, b) => a.position - b.position);
  const handover = pre.find((s) => s.stage === "handover");
  const ready =
    paper.status === "done" || (handover ? handover.status === "done" : pre.every((s) => s.status === "done"));
  if (ready) return { ...base, state: "ready", blocking: null, daysLate: 0, reason: "Handed over" };

  const inProgress = pre.filter((s) => s.status === "in_progress");
  const blocking = inProgress[0] ?? pre.find((s) => s.status === "waiting") ?? null;

  const overdue = inProgress.filter((s) => s.dueDate && s.dueDate < today);
  if (overdue.length > 0) {
    const worst = overdue[0];
    const late = Math.max(...overdue.map((s) => daysBetween(s.dueDate!, today)));
    return {
      ...base,
      state: "late",
      blocking: worst,
      daysLate: late,
      reason: `${STAGE_LABEL[worst.stage]} is ${plural(late, "day")} late`,
    };
  }
  if (examDay <= today) {
    const late = daysBetween(examDay, today);
    return {
      ...base,
      state: "late",
      blocking,
      daysLate: late,
      reason:
        late === 0
          ? "Exam is today and it isn't handed over"
          : `Exam was ${plural(late, "day")} ago and it isn't handed over`,
    };
  }

  const median = (stage: PaperStageName) => stats.find((x) => x.stage === stage)?.medianDays ?? 0;
  for (const s of inProgress) {
    if (!s.dueDate) continue;
    const started = s.startedAt ? colomboDay(s.startedAt) : today;
    const typical = Math.max(1, Math.round(median(s.stage)));
    const projected = addDays(started > today ? started : today, typical);
    if (projected > s.dueDate) {
      return {
        ...base,
        state: "at_risk",
        blocking: s,
        daysLate: 0,
        reason: `${STAGE_LABEL[s.stage]} usually takes ${plural(typical, "day")}`,
      };
    }
  }
  for (const s of pre.filter((x) => x.status === "waiting" && x.ownerId)) {
    const from = s.startDate ?? s.dueDate;
    if (!from || !s.dueDate) continue;
    if (awayBetween(daysOff, s.ownerId!, from, s.dueDate).length > 0) {
      return {
        ...base,
        state: "at_risk",
        blocking: s,
        daysLate: 0,
        reason: `${s.ownerName ?? "The owner"} is away during ${STAGE_LABEL[s.stage]}`,
      };
    }
  }
  return {
    ...base,
    state: "on_track",
    blocking,
    daysLate: 0,
    reason: blocking
      ? `${STAGE_LABEL[blocking.stage]} ${blocking.status === "in_progress" ? "in progress" : "is next"}`
      : "On track",
  };
}

const RANK: Record<PaperState, number> = { late: 0, at_risk: 1, on_track: 2, ready: 3 };

/** Late papers with an exam in the next 3 days first, then by exam day, then worst state first. */
export function sortCountdown(rows: CountdownRow[], today: string): CountdownRow[] {
  const soon = addDays(today, 3);
  const urgent = (r: CountdownRow) => (r.state === "late" && r.examDay <= soon ? 0 : 1);
  return [...rows].sort(
    (a, b) => urgent(a) - urgent(b) || a.examDay.localeCompare(b.examDay) || RANK[a.state] - RANK[b.state],
  );
}

export type OffsetSuggestion = {
  stage: PaperStageName;
  label: string;
  avgDaysLate: number;
  latePct: number;
  earlierBy: number;
  current: { start: number; due: number };
  next: { start: number; due: number };
};

/**
 * Stage types usually late (≥ 3 done, ≥ 40% late, ≥ 1 day on average): start them that many days
 * earlier than the default. The stats come from papers planned before any change, so the target is
 * counted from the default, and nothing is offered once the saved start is already that early.
 */
export function suggestOffsets(stats: StageStat[], offsets: StageOffsets): OffsetSuggestion[] {
  return stats
    .filter((s) => s.done >= 3 && s.late / s.done >= 0.4 && s.avgDaysLate >= 1)
    .map((s) => {
      const current = stageOffsets(s.stage, offsets);
      const earlierBy = Math.ceil(s.avgDaysLate);
      const target = Math.max(-30, stageOffsets(s.stage).start - earlierBy);
      return {
        stage: s.stage,
        label: STAGE_LABEL[s.stage],
        avgDaysLate: s.avgDaysLate,
        latePct: Math.round((s.late / s.done) * 100),
        earlierBy: current.start - target,
        current,
        next: { start: target, due: current.due },
      };
    })
    .filter((x) => x.earlierBy > 0);
}
