import "server-only";

import { after } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { APP_TIME_ZONE, monthKeyToDate } from "@/lib/month";

export type MonthDeadline = {
  /** "YYYY-MM" */
  month: string;
  /** First moment work is no longer accepted from members (ISO), or null when there is no deadline. */
  deadline: string | null;
  /** The last day work is accepted, e.g. "3 Nov 2026". */
  lastDayLabel: string | null;
  /** The last day as "YYYY-MM-DD" (for date inputs). */
  lastDay: string | null;
  passed: boolean;
  /** Whole days left (1 = last day today), or null when passed / no deadline. */
  daysLeft: number | null;
  /** A main admin gave this month a different deadline. */
  extended: boolean;
};

export type DeadlineSettings = { enabled: boolean; day: number; reminderDays: number };

const DAY_MS = 86_400_000;

function lastDayOf(deadline: string): { label: string; iso: string } {
  const last = new Date(new Date(deadline).getTime() - 1000);
  const label = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(last);
  const iso = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(last);
  return { label, iso };
}

/** Deadlines for several months ("YYYY-MM"). Works for every signed-in user. */
export async function getDeadlines(
  supabase: SupabaseClient<Database>,
  months: string[],
  now = Date.now(),
): Promise<Map<string, MonthDeadline>> {
  const result = new Map<string, MonthDeadline>();
  if (months.length === 0) return result;

  const [{ data }, { data: overrides }] = await Promise.all([
    supabase.rpc("work_deadlines", { p_months: months.map(monthKeyToDate) }),
    supabase.from("month_deadlines").select("month").in("month", months.map(monthKeyToDate)),
  ]);
  const extended = new Set((overrides ?? []).map((o) => o.month.slice(0, 7)));

  for (const month of months) {
    const row = (data ?? []).find((r) => r.month.slice(0, 7) === month);
    const deadline = row?.deadline ?? null;
    if (!deadline) {
      result.set(month, {
        month,
        deadline: null,
        lastDayLabel: null,
        lastDay: null,
        passed: false,
        daysLeft: null,
        extended: false,
      });
      continue;
    }
    const due = new Date(deadline).getTime();
    const passed = now >= due;
    const { label, iso } = lastDayOf(deadline);
    result.set(month, {
      month,
      deadline,
      lastDayLabel: label,
      lastDay: iso,
      passed,
      daysLeft: passed ? null : Math.ceil((due - now) / DAY_MS),
      extended: extended.has(month),
    });
  }
  return result;
}

export async function getDeadline(supabase: SupabaseClient<Database>, month: string): Promise<MonthDeadline> {
  return (await getDeadlines(supabase, [month])).get(month)!;
}

/** The normal deadline rule (admins only can read it). */
export async function getDeadlineSettings(supabase: SupabaseClient<Database>): Promise<DeadlineSettings> {
  const { data } = await supabase
    .from("app_settings")
    .select("deadline_enabled, deadline_day, reminder_days")
    .maybeSingle();
  return {
    enabled: data?.deadline_enabled ?? true,
    day: data?.deadline_day ?? 3,
    reminderDays: data?.reminder_days ?? 3,
  };
}

/**
 * Sends any due deadline and task reminders (each one only once) AFTER the
 * page has been sent, so dashboards don't wait for it. The daily job sends
 * them too; this just catches up when someone opens the app.
 */
export async function sendDueRemindersLater(supabase: SupabaseClient<Database>): Promise<void> {
  // Request data (the session cookie) must be read before the page finishes.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return;
  after(async () => {
    try {
      const client = createSupabaseClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      await client.rpc("send_deadline_reminders");
    } catch {
      // Best effort.
    }
  });
}
