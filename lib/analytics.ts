import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { monthKeyToDate, monthLabel, shiftMonth } from "@/lib/month";
import { salaryLinesOf } from "@/lib/payments";
import { getStructure } from "@/lib/queries";

// "Spent" = approved work (price locked at approval).
// "Pending" = work waiting for review, estimated at today's rates.

export type MonthSpend = { key: string; month: string; spent: number; pending: number };
export type SectionSpend = { key: string; section: string; spent: number; fill: string };
export type RoleSpend = {
  roleId: string;
  role: string;
  section: string;
  units: number;
  spent: number;
  pending: number;
};
export type MemberPayout = {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  bankLast4: string | null;
  bankName: string | null;
  approvedItems: number;
  approvedUnits: number;
  /** Approved work amount. */
  spent: number;
  /** Fixed monthly salary (salaried roles). */
  salary: number;
  salaryRoles: string[];
  /** spent + salary */
  total: number;
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
  /** Fixed salaries included in `spent` for the selected month. */
  salaryTotal: number;
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

  const [
    { data: rows },
    structure,
    { data: settings },
    { data: profiles },
    { data: banks },
    { data: roleRows },
    { data: salaryRows },
    { data: holderRows },
    { data: closedRows },
    { data: closedMonthRows },
  ] = await Promise.all([
    supabase
      .from("submissions")
      .select("user_id, role_id, work_month, status, quantity, amount, unit_price, rate_item_id")
      .gte("work_month", first)
      .lte("work_month", last),
    getStructure(supabase),
    supabase.from("app_settings").select("monthly_budget").maybeSingle(),
    supabase.from("profiles").select("id, full_name, email, phone, is_active"),
    supabase.from("bank_details").select("user_id, bank_name, account_last4"),
    supabase.from("roles").select("id, name, is_salaried"),
    supabase.from("member_salaries").select("user_id, role_id, monthly_amount, created_at"),
    supabase.from("member_roles").select("user_id, role_id"),
    // Closed months keep the salaries saved when they were closed.
    supabase.from("payouts").select("month, user_id, salary_lines").gte("month", first).lte("month", last),
    supabase.from("pay_months").select("month").gte("month", first).lte("month", last),
  ]);

  const submissions = rows ?? [];
  const roleInfo = new Map(
    structure.flatMap((s) => s.roles.map((r) => [r.id, { role: r.name, section: s.name }] as const)),
  );
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const bankByUser = new Map((banks ?? []).map((b) => [b.user_id, b]));

  // Months (radar)
  const months: MonthSpend[] = keys.map((key) => ({
    key,
    month: monthLabel(key, "short").split(" ")[0],
    spent: 0,
    pending: 0,
  }));
  const monthIndex = new Map(keys.map((k, i) => [k, i]));

  // Fixed salaries that apply: salaried role, member still holds it and is active.
  const salariedRoleIds = new Set((roleRows ?? []).filter((r) => r.is_salaried).map((r) => r.id));
  const holds = new Set((holderRows ?? []).map((h) => `${h.user_id}:${h.role_id}`));
  const salaries = (salaryRows ?? []).filter(
    (s) =>
      num(s.monthly_amount) > 0 &&
      salariedRoleIds.has(s.role_id) &&
      holds.has(`${s.user_id}:${s.role_id}`) &&
      profileById.get(s.user_id)?.is_active,
  );
  type SalaryEntry = { user_id: string; role_id: string; amount: number };
  // Closed months: the salary lines saved in their payouts. Payout rows only
  // exist for closed months (and only main admins can read them).
  const closedSalaries = new Map<string, SalaryEntry[]>(
    (closedMonthRows ?? []).map((r) => [r.month.slice(0, 7), [] as SalaryEntry[]]),
  );
  for (const row of closedRows ?? []) {
    const key = row.month.slice(0, 7);
    const list = closedSalaries.get(key) ?? [];
    if (row.user_id) {
      for (const line of salaryLinesOf(row)) list.push({ user_id: row.user_id, role_id: line.roleId, amount: line.amount });
    }
    closedSalaries.set(key, list);
  }
  // Open months: a salary counts from the month it was first set (current amounts).
  const salariesFor = (key: string): SalaryEntry[] =>
    closedSalaries.get(key) ??
    salaries
      .filter((s) => s.created_at.slice(0, 7) <= key)
      .map((s) => ({ user_id: s.user_id, role_id: s.role_id, amount: num(s.monthly_amount) }));

  for (const m of months) {
    for (const s of salariesFor(m.key)) m.spent += s.amount;
  }

  // Current month breakdowns
  const sectionTotals = new Map<string, number>(structure.map((s) => [s.name, 0]));
  const roleTotals = new Map<string, RoleSpend>();
  const payouts = new Map<string, MemberPayout>();
  let unpricedApproved = 0;

  const payoutFor = (userId: string): MemberPayout => {
    const existing = payouts.get(userId);
    if (existing) return existing;
    const profile = profileById.get(userId);
    const bank = bankByUser.get(userId);
    const created: MemberPayout = {
      userId,
      name: profile?.full_name || profile?.email || "Unknown member",
      email: profile?.email ?? "",
      phone: profile?.phone ?? null,
      bankLast4: bank?.account_last4 ?? null,
      bankName: bank?.bank_name ?? null,
      approvedItems: 0,
      approvedUnits: 0,
      spent: 0,
      salary: 0,
      salaryRoles: [],
      total: 0,
      pending: 0,
    };
    payouts.set(userId, created);
    return created;
  };

  // Salaries for the selected month
  let salaryTotal = 0;
  for (const s of salariesFor(month)) {
    const amount = s.amount;
    const info = roleInfo.get(s.role_id) ?? { role: "Salaried role", section: "Other" };
    const payout = payoutFor(s.user_id);
    payout.salary += amount;
    payout.salaryRoles.push(info.role);
    const role =
      roleTotals.get(s.role_id) ??
      ({
        roleId: s.role_id,
        role: info.role,
        section: info.section,
        units: 0,
        spent: 0,
        pending: 0,
      } satisfies RoleSpend);
    role.spent += amount;
    roleTotals.set(s.role_id, role);
    sectionTotals.set(info.section, (sectionTotals.get(info.section) ?? 0) + amount);
    salaryTotal += amount;
  }

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
      ({
        roleId: s.role_id,
        role: info.role,
        section: info.section,
        units: 0,
        spent: 0,
        pending: 0,
      } satisfies RoleSpend);
    const payout = payoutFor(s.user_id);

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
  }
  for (const p of payouts.values()) p.total = p.spent + p.salary;

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
    payouts: [...payouts.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    spent: current?.spent ?? 0,
    pending: current?.pending ?? 0,
    previousSpent: previous?.spent ?? 0,
    periodSpent: months.reduce((s, m) => s + m.spent, 0),
    budget: num(settings?.monthly_budget),
    salariedRoles: (roleRows ?? []).filter((r) => r.is_salaried).map((r) => r.name),
    salaryTotal,
    unpricedApproved,
  };
}

/** % change from previous to current (null when there is nothing to compare). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
