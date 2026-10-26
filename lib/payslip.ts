import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthSession } from "@/lib/auth";
import { MEMBERS_CAN_SEE_PAYSLIPS } from "@/lib/config";
import type { Database, Payout, Profile } from "@/lib/database.types";
import { dateToMonthKey } from "@/lib/month";
import { normalisePayout, salaryLinesOf, workLinesOf, type SalaryLine, type WorkLine } from "@/lib/payments";

export type Payslip = {
  payout: Payout;
  monthKey: string;
  salaryLines: SalaryLine[];
  workLines: WorkLine[];
  closedAt: string | null;
  paidByName: string | null;
  /** True when the viewer is a main admin looking at someone else's payslip. */
  viewingAsAdmin: boolean;
};

/**
 * A payslip the viewer may see, or null. Row Level Security already limits
 * payouts to the owner and to main admins with two-step login.
 */
export async function getPayslip(
  supabase: SupabaseClient<Database>,
  viewer: Profile,
  id: string,
): Promise<Payslip | null> {
  const { data } = await supabase
    .from("payouts")
    .select("*, payer:profiles!payouts_paid_by_fkey(full_name, email), pay_months(closed_at)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const session = await getAuthSession();
  const isMainAdmin = viewer.is_main_admin && Boolean(session?.twoStepVerified);
  const own = data.user_id === viewer.id;
  if (!isMainAdmin && !(own && MEMBERS_CAN_SEE_PAYSLIPS)) return null;

  const { payer, pay_months, ...row } = data as typeof data & {
    payer: { full_name: string; email: string } | null;
    pay_months: { closed_at: string } | null;
  };
  const payout = normalisePayout(row as Payout);
  return {
    payout,
    monthKey: dateToMonthKey(payout.month),
    salaryLines: salaryLinesOf(payout),
    workLines: workLinesOf(payout),
    closedAt: pay_months?.closed_at ?? null,
    paidByName: payer ? payer.full_name || payer.email : null,
    viewingAsAdmin: isMainAdmin && !own,
  };
}

/** "Flyer · 3 × Rs. 1,500.00" style label for a work line. */
export function workLineLabel(line: WorkLine): string {
  return line.item ? `${line.role} – ${line.item}` : line.role;
}
