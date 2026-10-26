import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Payout } from "@/lib/database.types";
import { dateToMonthKey, monthKeyToDate } from "@/lib/month";

export type SalaryLine = { roleId: string; role: string; amount: number };
export type WorkLine = {
  roleId: string;
  role: string;
  item: string | null;
  unit: string | null;
  items: number;
  quantity: number;
  unitPrice: number | null;
  amount: number;
};

export type PayMonth = {
  month: string;
  closedAt: string;
  closedByName: string | null;
  note: string | null;
};

export type PayoutTotals = {
  members: number;
  total: number;
  paid: number;
  outstanding: number;
  paidCount: number;
  /** Members with something to pay (total > 0). */
  toPayCount: number;
  /** Members with something to pay who aren't marked as paid yet. */
  unpaidCount: number;
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const asObjects = (value: Json): Record<string, Json>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v)) : [];

const str = (v: Json | undefined) => (typeof v === "string" ? v : null);

export function salaryLinesOf(payout: Pick<Payout, "salary_lines">): SalaryLine[] {
  return asObjects(payout.salary_lines).map((l) => ({
    roleId: str(l.role_id) ?? "",
    role: str(l.role) ?? "Salaried role",
    amount: num(l.amount),
  }));
}

export function workLinesOf(payout: Pick<Payout, "work_lines">): WorkLine[] {
  return asObjects(payout.work_lines).map((l) => ({
    roleId: str(l.role_id) ?? "",
    role: str(l.role) ?? "Role",
    item: str(l.item),
    unit: str(l.unit),
    items: num(l.items),
    quantity: num(l.quantity),
    unitPrice: l.unit_price === null || l.unit_price === undefined ? null : num(l.unit_price),
    amount: num(l.amount),
  }));
}

export function payoutTotals(payouts: Pick<Payout, "total_amount" | "status">[]): PayoutTotals {
  const t: PayoutTotals = {
    members: payouts.length,
    total: 0,
    paid: 0,
    outstanding: 0,
    paidCount: 0,
    toPayCount: 0,
    unpaidCount: 0,
  };
  for (const p of payouts) {
    const amount = num(p.total_amount);
    t.total += amount;
    if (amount > 0) t.toPayCount += 1;
    if (p.status === "paid") {
      t.paid += amount;
      t.paidCount += 1;
    } else {
      t.outstanding += amount;
      if (amount > 0) t.unpaidCount += 1;
    }
  }
  return t;
}

/** The closed-month record for a month key, or null when the month is open. */
export async function getPayMonth(supabase: SupabaseClient<Database>, month: string): Promise<PayMonth | null> {
  const { data } = await supabase
    .from("pay_months")
    .select("month, closed_at, note, closer:profiles!pay_months_closed_by_fkey(full_name, email)")
    .eq("month", monthKeyToDate(month))
    .maybeSingle();
  if (!data) return null;
  const closer = data.closer as { full_name: string; email: string } | null;
  return {
    month,
    closedAt: data.closed_at,
    closedByName: closer ? closer.full_name || closer.email : null,
    note: data.note,
  };
}

/** Month keys ("YYYY-MM") of all closed months, newest first. */
export async function getClosedMonthKeys(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data } = await supabase.from("pay_months").select("month").order("month", { ascending: false });
  return (data ?? []).map((r) => dateToMonthKey(r.month));
}

export async function getPayoutsForMonth(supabase: SupabaseClient<Database>, month: string): Promise<Payout[]> {
  const { data } = await supabase
    .from("payouts")
    .select("*")
    .eq("month", monthKeyToDate(month))
    .order("payslip_no", { ascending: true });
  return (data ?? []).map(normalisePayout);
}

/** Numeric columns can arrive as strings; make them numbers. */
export function normalisePayout(p: Payout): Payout {
  return {
    ...p,
    salary_amount: num(p.salary_amount),
    work_amount: num(p.work_amount),
    total_amount: num(p.total_amount),
  };
}
