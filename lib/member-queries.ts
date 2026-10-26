import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemberSubmission } from "@/components/member/submission-card";
import type { Database } from "@/lib/database.types";
import { monthKeyToDate } from "@/lib/month";

export const MEMBER_SUBMISSION_SELECT =
  "id, title, description, quantity, date_done, links, status, admin_comment, work_month, created_at, roles(name, sections(name)), submission_attachments(id, file_name, size_bytes)" as const;

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

export function summarise(rows: { status: string }[]) {
  return {
    total: rows.length,
    approved: rows.filter((r) => r.status === "approved").length,
    pending: rows.filter((r) => r.status === "pending").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
  };
}
