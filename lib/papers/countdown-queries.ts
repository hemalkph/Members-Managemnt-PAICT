import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { friendlyDbError } from "@/lib/core/action-result";
import { addDays, type StageOffsets } from "@/lib/papers";
import {
  paperCountdown,
  sortCountdown,
  suggestOffsets,
  type CountdownRow,
  type OffsetSuggestion,
  type StageStat,
} from "@/lib/papers/countdown";
import { getPapers } from "@/lib/papers/queries";
import { getTeamDirectory, teamNames } from "@/lib/members/team-directory";
import type { Database } from "@/lib/supabase/database.types";
import { getTeamDaysOff } from "@/lib/team/days-off-queries";

export const COUNTDOWN_DAYS = 42;

export type CountdownPage = {
  rows: CountdownRow[];
  stats: StageStat[];
  suggestions: OffsetSuggestion[];
  /** Owner id → WhatsApp number, for the "message them" link. */
  whatsapp: Record<string, string>;
  error: string | null;
};

/** Papers in progress with an exam in the next 6 weeks (or past and not handed over), worst first. */
export async function getCountdownPage(supabase: SupabaseClient<Database>, today: string): Promise<CountdownPage> {
  const end = addDays(today, COUNTDOWN_DAYS);
  const [team, stats, offsetsRes, { data: exams }, daysOff] = await Promise.all([
    getTeamDirectory(supabase),
    supabase.rpc("paper_stage_stats"),
    supabase.rpc("paper_stage_offsets"),
    supabase.from("exams").select("id, exam_date"),
    getTeamDaysOff(supabase, today, end),
  ]);
  if (stats.error) {
    return { rows: [], stats: [], suggestions: [], whatsapp: {}, error: friendlyDbError(stats.error) };
  }

  const papers = await getPapers(supabase, { status: "in_progress" }, teamNames(team));
  const examDate = new Map((exams ?? []).map((e) => [e.id, e.exam_date as string | null]));
  const statList: StageStat[] = (stats.data ?? []).map((s) => ({
    stage: s.stage,
    done: s.done,
    late: s.late,
    avgDaysLate: Number(s.avg_days_late),
    medianDays: Number(s.median_days),
  }));

  const rows = papers
    .map((p) => ({ p, examDay: p.examDay ?? (p.examId ? examDate.get(p.examId) : null) ?? null }))
    .filter((x): x is { p: (typeof papers)[number]; examDay: string } => Boolean(x.examDay) && x.examDay! <= end)
    .map(({ p, examDay }) => paperCountdown(p, examDay, today, statList, daysOff))
    .filter((r) => r.examDay >= today || r.state !== "ready");

  return {
    rows: sortCountdown(rows, today),
    stats: statList,
    suggestions: suggestOffsets(statList, (offsetsRes.data ?? {}) as StageOffsets),
    whatsapp: Object.fromEntries(team.filter((m) => m.whatsapp).map((m) => [m.id, m.whatsapp!])),
    error: null,
  };
}
