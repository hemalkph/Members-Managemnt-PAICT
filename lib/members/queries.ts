import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemberSubmission } from "@/components/member/submission-card";
import type { Database } from "@/lib/supabase/database.types";
import { currentMonthKey, dateToMonthKey, monthKeyToDate, todayISO } from "@/lib/core/month";
import { paidFrom, salariesInEffect } from "@/lib/core/salary";

export const MEMBER_SUBMISSION_SELECT =
  "id, title, description, quantity, date_done, links, status, admin_comment, resubmitted_at, work_month, created_at, unit_price, amount, rate_items(name, unit), exam:exams(name), centre:centres(name), roles(name, sections(name)), submission_attachments(id, file_name, size_bytes), submission_videos(drive_file_id, name, source, folder_name, duration_ms)" as const;

/** One member's submissions for a month (RLS limits members to their own). */
export async function getSubmissionsForMonth(
  supabase: SupabaseClient<Database>,
  userId: string,
  month: string,
): Promise<MemberSubmission[]> {
  const { data } = await supabase
    .from("submissions")
    .select(MEMBER_SUBMISSION_SELECT)
    .eq("user_id", userId)
    .eq("work_month", monthKeyToDate(month))
    .order("date_done", { ascending: false })
    .order("created_at", { ascending: false });
  return data ?? [];
}

export function summarise(rows: { status: string; amount?: number | string | null }[]) {
  const sum = (status: string) =>
    rows.filter((r) => r.status === status).reduce((total, r) => total + (Number(r.amount ?? 0) || 0), 0);
  return {
    total: rows.length,
    approved: rows.filter((r) => r.status === "approved").length,
    pending: rows.filter((r) => r.status === "pending").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
    earnedApproved: sum("approved"),
    earnedPending: sum("pending"),
  };
}

/** The member's own fixed salary for a pay month (salaried roles they still hold, from their pay start). */
export async function getMySalary(
  supabase: SupabaseClient<Database>,
  userId: string,
  month: string,
): Promise<number> {
  const [{ data: salaries }, { data: held }, { data: start }] = await Promise.all([
    supabase
      .from("member_salaries")
      .select("user_id, role_id, from_month, monthly_amount, roles(is_salaried)")
      .eq("user_id", userId),
    supabase.from("member_roles").select("role_id").eq("user_id", userId),
    supabase.from("member_pay_starts").select("from_month").eq("user_id", userId).maybeSingle(),
  ]);
  if (!paidFrom(start?.from_month, month)) return 0;
  const heldIds = new Set((held ?? []).map((r) => r.role_id));
  return salariesInEffect(salaries ?? [], month)
    .filter((s) => s.roles?.is_salaried && heldIds.has(s.role_id))
    .reduce((sum, s) => sum + (Number(s.monthly_amount) || 0), 0);
}

/** The pay month the member's new work goes to: this month, or their later pay start month. */
export async function getMyPayMonth(supabase: SupabaseClient<Database>, userId: string): Promise<string> {
  // The database's open month: last month until it is closed.
  const [{ data: open }, { data }] = await Promise.all([
    supabase.rpc("open_pay_period", { p_day: todayISO() }),
    supabase.from("member_pay_starts").select("from_month").eq("user_id", userId).maybeSingle(),
  ]);
  const now = open ? dateToMonthKey(open) : currentMonthKey();
  const start = data ? dateToMonthKey(data.from_month) : now;
  return start > now ? start : now;
}
