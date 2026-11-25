// Pure shaping for the Money page (no server imports, so unit tests can load it).
import { dateToMonthKey, monthLabel } from "@/lib/core/month";
import type { MonthSpend } from "@/lib/payments/analytics";
import type { Database } from "@/lib/supabase/database.types";

type Fns = Database["public"]["Functions"];
export type IncomeRow = Fns["money_income"]["Returns"][number];
export type CostRow = Fns["money_costs"]["Returns"][number];
export type IncomeSource = IncomeRow["income_source"];

export type MoneyClassCell = {
  classId: string;
  name: string;
  batch: string;
  fee: number | null;
  paid: number | null;
  free: number;
  income: number | null;
  source: IncomeSource;
};

export type MoneyMonth = {
  key: string;
  label: string;
  classes: MoneyClassCell[];
  income: number;
  staff: number;
  /** Payslips made for this month; otherwise staff pay is an estimate. */
  staffClosed: boolean;
  printing: number;
  postage: number;
  profit: number;
  /** Classes with a count but no fee: their income is left out. */
  missingFees: number;
};

export type ClassFeeRow = {
  classId: string;
  name: string;
  batch: string;
  isActive: boolean;
  fee: number | null;
  fromMonth: string | null;
};

const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** One entry per month key (oldest first), joining income, costs and staff pay. */
export function buildMoneyMonths(
  keys: string[],
  income: IncomeRow[],
  costs: CostRow[],
  staff: MonthSpend[],
  closedKeys: string[],
): MoneyMonth[] {
  const closed = new Set(closedKeys);
  return keys.map((key) => {
    const classes: MoneyClassCell[] = income
      .filter((r) => dateToMonthKey(r.month) === key)
      .map((r) => ({
        classId: r.class_id,
        name: r.class_name,
        batch: r.batch_name,
        fee: r.fee === null ? null : num(r.fee),
        paid: r.paid,
        free: r.free,
        income: r.income === null ? null : num(r.income),
        source: r.income_source,
      }));
    const cost = costs.find((c) => dateToMonthKey(c.month) === key);
    const totalIncome = classes.reduce((sum, c) => sum + (c.income ?? 0), 0);
    const staffPay = num(staff.find((s) => s.key === key)?.spent);
    const printing = num(cost?.printing);
    const postage = num(cost?.postage);
    return {
      key,
      label: monthLabel(key, "short"),
      classes,
      income: totalIncome,
      staff: staffPay,
      staffClosed: closed.has(key),
      printing,
      postage,
      profit: totalIncome - staffPay - printing - postage,
      missingFees: classes.filter((c) => c.source === "no_fee").length,
    };
  });
}
