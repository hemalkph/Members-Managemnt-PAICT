import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { friendlyDbError } from "@/lib/core/action-result";
import { monthKeyToDate, shiftMonth } from "@/lib/core/month";
import { buildMoneyMonths, type ClassFeeRow, type MoneyMonth } from "@/lib/money/build";
import { getClosedMonthKeys } from "@/lib/payments";
import { getAnalytics } from "@/lib/payments/analytics";
import type { Database } from "@/lib/supabase/database.types";

export type { ClassFeeRow, MoneyClassCell, MoneyMonth } from "@/lib/money/build";

export const MONEY_MONTHS = 6;

/** The 6 months ending at `month` (oldest first) and every class's fee. Main admins only. */
export async function getMoneyPage(
  supabase: SupabaseClient<Database>,
  month: string,
): Promise<{ months: MoneyMonth[]; fees: ClassFeeRow[]; error: string | null }> {
  const keys = Array.from({ length: MONEY_MONTHS }, (_, i) => shiftMonth(month, i - (MONEY_MONTHS - 1)));
  const range = { p_from: monthKeyToDate(keys[0]), p_to: monthKeyToDate(month) };

  const [income, costs, fees, analytics, closedKeys] = await Promise.all([
    supabase.rpc("money_income", range),
    supabase.rpc("money_costs", range),
    supabase.rpc("class_fee_list"),
    getAnalytics(supabase, month, MONEY_MONTHS),
    getClosedMonthKeys(supabase),
  ]);

  const failed = income.error ?? costs.error ?? fees.error;
  if (failed) return { months: [], fees: [], error: friendlyDbError(failed) };

  return {
    months: buildMoneyMonths(keys, income.data ?? [], costs.data ?? [], analytics.months, closedKeys),
    fees: (fees.data ?? []).map((f) => ({
      classId: f.class_id,
      name: f.class_name,
      batch: f.batch_name,
      isActive: f.is_active,
      fee: f.fee === null ? null : Number(f.fee),
      fromMonth: f.from_month,
    })),
    error: null,
  };
}
