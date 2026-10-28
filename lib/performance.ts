import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PaperStageName } from "@/lib/database.types";
import { APP_TIME_ZONE, currentMonthKey, monthKeyToDate, shiftMonth, todayISO } from "@/lib/month";
import { STAGES } from "@/lib/papers";

type Client = SupabaseClient<Database>;

const DAY = 86_400_000;
/** Members need at least this many tasks before they're ranked. */
export const MIN_FOR_RANKING = 3;

export type MemberPerformance = {
  id: string;
  name: string;
  avatarPath: string | null;
  done: number;
  /** Done tasks that had a due date. */
  withDue: number;
  onTime: number;
  /** 0–100, null when nothing with a due date was done. */
  onTimeRate: number | null;
  /** Average days from start to done, null when nothing was done. */
  avgDays: number | null;
  pages: number;
  overdueNow: number;
  openNow: number;
};

export type StagePerformance = {
  stage: PaperStageName;
  label: string;
  done: number;
  avgDays: number | null;
  plannedDays: number | null;
  onTimeRate: number | null;
};

export type TeamPerformance = {
  months: string[];
  members: MemberPerformance[];
  stages: StagePerformance[];
  pagesByMonth: { month: string; pages: number }[];
  team: { done: number; onTimeRate: number | null; avgDays: number | null; pages: number; overdueNow: number };
};

const dateInColombo = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }).format(new Date(iso));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

type TaskRow = {
  assignee_id: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  status: string;
  stage: {
    stage: PaperStageName;
    started_at: string | null;
    start_date: string | null;
    due_date: string | null;
  } | null;
};

/**
 * Team performance over the last `monthCount` months (this month included):
 * tasks (paper stages and other tasks) done on time, how long they took, and
 * approved pages. For admins (RLS lets them read everything used here).
 */
export async function getTeamPerformance(supabase: Client, monthCount: number): Promise<TeamPerformance> {
  const thisMonth = currentMonthKey();
  const months = Array.from({ length: monthCount }, (_, i) => shiftMonth(thisMonth, i - monthCount + 1));
  const fromDate = monthKeyToDate(months[0]);
  const today = todayISO();

  const [{ data: profiles }, { data: doneRows }, { data: openRows }, { data: subs }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, avatar_path").eq("is_active", true),
    supabase
      .from("tasks")
      .select(
        "assignee_id, due_date, completed_at, created_at, status, stage:paper_stages(stage, started_at, start_date, due_date)",
      )
      .eq("status", "done")
      .gte("completed_at", `${fromDate}T00:00:00+05:30`)
      .limit(5000),
    supabase.from("tasks").select("assignee_id, due_date").eq("status", "open").limit(5000),
    supabase
      .from("submissions")
      .select("user_id, quantity, work_month, rate_items(unit)")
      .eq("status", "approved")
      .gte("work_month", fromDate)
      .limit(10000),
  ]);

  const tasks = (doneRows ?? []) as unknown as TaskRow[];
  const pageSubs = (subs ?? []).filter((s) => /page/i.test((s.rate_items as { unit: string } | null)?.unit ?? ""));

  const daysTaken = (t: TaskRow) => {
    const start = t.stage?.started_at ?? t.created_at;
    return Math.max(0, (Date.parse(t.completed_at!) - Date.parse(start)) / DAY);
  };
  const wasOnTime = (t: TaskRow) =>
    Boolean(t.due_date && t.completed_at && dateInColombo(t.completed_at) <= t.due_date);

  const members: MemberPerformance[] = (profiles ?? []).map((p) => {
    const mine = tasks.filter((t) => t.assignee_id === p.id && t.completed_at);
    const withDue = mine.filter((t) => t.due_date);
    const onTime = withDue.filter(wasOnTime).length;
    const open = (openRows ?? []).filter((t) => t.assignee_id === p.id);
    return {
      id: p.id,
      name: p.full_name || p.email,
      avatarPath: p.avatar_path,
      done: mine.length,
      withDue: withDue.length,
      onTime,
      onTimeRate: pct(onTime, withDue.length),
      avgDays: round1(mean(mine.map(daysTaken))),
      pages: pageSubs.filter((s) => s.user_id === p.id).reduce((sum, s) => sum + (s.quantity || 0), 0),
      overdueNow: open.filter((t) => t.due_date && t.due_date < today).length,
      openNow: open.length,
    };
  });
  // Busiest first; people with nothing in the period last.
  members.sort((a, b) => b.done + b.pages / 10 - (a.done + a.pages / 10) || a.name.localeCompare(b.name));

  const stages: StagePerformance[] = STAGES.map((meta) => {
    const rows = tasks.filter((t) => t.stage?.stage === meta.stage && t.completed_at);
    const planned = rows
      .filter((t) => t.stage?.start_date && t.stage?.due_date)
      .map((t) => (Date.parse(t.stage!.due_date!) - Date.parse(t.stage!.start_date!)) / DAY + 1);
    const withDue = rows.filter((t) => t.due_date);
    return {
      stage: meta.stage,
      label: meta.label,
      done: rows.length,
      avgDays: round1(mean(rows.map(daysTaken))),
      plannedDays: round1(mean(planned)),
      onTimeRate: pct(withDue.filter(wasOnTime).length, withDue.length),
    };
  });

  const pagesByMonth = months.map((m) => ({
    month: m,
    pages: pageSubs.filter((s) => s.work_month.slice(0, 7) === m).reduce((sum, s) => sum + (s.quantity || 0), 0),
  }));

  const allWithDue = tasks.filter((t) => t.due_date && t.completed_at);
  return {
    months,
    members,
    stages,
    pagesByMonth,
    team: {
      done: tasks.length,
      onTimeRate: pct(allWithDue.filter(wasOnTime).length, allWithDue.length),
      avgDays: round1(mean(tasks.filter((t) => t.completed_at).map(daysTaken))),
      pages: pagesByMonth.reduce((s, m) => s + m.pages, 0),
      overdueNow: (openRows ?? []).filter((t) => t.due_date && t.due_date < today).length,
    },
  };
}
