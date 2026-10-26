import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { monthKeyToDate, monthLabel, shiftMonth } from "@/lib/month";
import { getStructure } from "@/lib/queries";

// "Spent" = approved work (price locked at approval).
// "Pending" = work waiting for review, estimated at today's rates.

export type MonthSpend = { key: string; month: string; spent: number; pending: number };
export type SectionSpend = { key: string; section: string; spent: number; fill: string };
export type RoleSpend = { roleId: string; role: string; section: string; units: number; spent: number; pending: number };
export type MemberPayout = {
  userId: string;
  name: string;
  email: string;
  bankLast4: string | null;
  bankName: string | null;
  approvedItems: number;
  approvedUnits: number;
  spent: number;
  pending: number;
};

export type AnalyticsData = {
  month: string;
  months: MonthSpend[];
  sections: SectionSpend[];
  roles: RoleSpend[];
  payouts: MemberPayout[];
  spent: number;
  pending: number;
  previousSpent: number;
  periodSpent: number;
  budget: number;
  salariedRoles: string[];
  unpricedApproved: number;
};

const SECTION_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export async function getAnalytics(
  supabase: SupabaseClient<Database>,
  month: string,
  monthsBack = 6,
): Promise<AnalyticsData> {
  const keys = Array.from({ length: monthsBack }, (_, i) => shiftMonth(month, i - (monthsBack - 1)));
  const first = monthKeyToDate(keys[0]);
  const last = monthKeyToDate(month);

  const [{ data: rows }, structure, { data: settings }, { data: profiles }, { data: banks }, { data: roleRows }] =
    await Promise.all([
      supabase
        .from("submissions")
        .select("user_id, role_id, work_month, status, quantity, amount, unit_price, rate_item_id")
        .gte("work_month", first)
        .lte("work_month", last),
      getStructure(supabase),
      supabase.from("app_settings").select("monthly_budget").maybeSingle(),
      supabase.from("profiles").select("id, full_name, email"),
      supabase.from("bank_details").select("user_id, bank_name, account_last4"),
      supabase.from("roles").select("id, name, is_salaried"),
    ]);

  const submissions = rows ?? [];
  const roleInfo = new Map(structure.flatMap((s) => s.roles.map((r) => [r.id, { role: r.name, section: s.name }] as const)));
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const bankByUser = new Map((banks ?? []).map((b) => [b.user_id, b]));

  // Months (radar)
  const months: MonthSpend[] = keys.map((key) => ({ key, month: monthLabel(key, "short").split(" ")[0], spent: 0, pending: 0 }));
  const monthIndex = new Map(keys.map((k, i) => [k, i]));

  // Current month breakdowns
  const sectionTotals = new Map<string, number>(structure.map((s) => [s.name, 0]));
  const roleTotals = new Map<string, RoleSpend>();
  const payouts = new Map<string, MemberPayout>();
  let unpricedApproved = 0;

  for (const s of submissions) {
    const key = s.work_month.slice(0, 7);
    const amount = num(s.amount);
    const m = months[monthIndex.get(key) ?? -1];
    if (m) {
      if (s.status === "approved") m.spent += amount;
      if (s.status === "pending") m.pending += amount;
    }
    if (key !== month || s.status === "rejected") continue;

    const info = roleInfo.get(s.role_id) ?? { role: "Deleted role", section: "Other" };
    const role =
      roleTotals.get(s.role_id) ??
      ({ roleId: s.role_id, role: info.role, section: info.section, units: 0, spent: 0, pending: 0 } satisfies RoleSpend);
    const profile = profileById.get(s.user_id);
    const bank = bankByUser.get(s.user_id);
    const payout =
      payouts.get(s.user_id) ??
      ({
        userId: s.user_id,
        name: profile?.full_name || profile?.email || "Unknown member",
        email: profile?.email ?? "",
        bankLast4: bank?.account_last4 ?? null,
        bankName: bank?.bank_name ?? null,
        approvedItems: 0,
        approvedUnits: 0,
        spent: 0,
        pending: 0,
      } satisfies MemberPayout);

    if (s.status === "approved") {
      role.units += s.quantity;
      role.spent += amount;
      payout.approvedItems += 1;
      payout.approvedUnits += s.quantity;
      payout.spent += amount;
      sectionTotals.set(info.section, (sectionTotals.get(info.section) ?? 0) + amount);
      if (s.rate_item_id === null && s.unit_price === null) unpricedApproved += 1;
    } else {
      role.pending += amount;
      payout.pending += amount;
    }
    roleTotals.set(s.role_id, role);
    payouts.set(s.user_id, payout);
  }

  const sections: SectionSpend[] = [...sectionTotals.entries()].map(([section, spent], i) => ({
    key: `s${i}`,
    section,
    spent,
    fill: SECTION_COLORS[i % SECTION_COLORS.length],
  }));

  const current = months[months.length - 1];
  const previous = months[months.length - 2];

  return {
    month,
    months,
    sections,
    roles: [...roleTotals.values()].sort((a, b) => b.spent - a.spent || a.role.localeCompare(b.role)),
    payouts: [...payouts.values()].sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name)),
    spent: current?.spent ?? 0,
    pending: current?.pending ?? 0,
    previousSpent: previous?.spent ?? 0,
    periodSpent: months.reduce((s, m) => s + m.spent, 0),
    budget: num(settings?.monthly_budget),
    salariedRoles: (roleRows ?? []).filter((r) => r.is_salaried).map((r) => r.name),
    unpricedApproved,
  };
}

/** % change from previous to current (null when there is nothing to compare). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
