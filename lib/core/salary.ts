// Fixed salaries keep their history: each row is an amount from a pay month
// (from_month, "YYYY-MM-01"). Same rule as public.close_pay_month.

type SalaryRow = { user_id: string; role_id: string; from_month: string };

/** Each member's salary row per role in a pay month: the latest one set from that month or before. */
export function salariesInEffect<T extends SalaryRow>(rows: readonly T[], monthKey: string): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (row.from_month.slice(0, 7) > monthKey) continue;
    const key = `${row.user_id}:${row.role_id}`;
    const seen = latest.get(key);
    if (!seen || row.from_month > seen.from_month) latest.set(key, row);
  }
  return [...latest.values()];
}

/** True when a member with this pay start month ("YYYY-MM-01" or none) is paid in the month. */
export function paidFrom(startMonth: string | null | undefined, monthKey: string): boolean {
  return !startMonth || startMonth.slice(0, 7) <= monthKey;
}

/** One member's salary for a role in a month, and the next change already set after it. */
export function salaryNowAndNext(
  rows: readonly (SalaryRow & { monthly_amount: number | string })[],
  monthKey: string,
): { amount: number; next: { amount: number; month: string } | null } {
  const amount = Number(salariesInEffect(rows, monthKey)[0]?.monthly_amount ?? 0);
  const later = rows
    .filter((r) => r.from_month.slice(0, 7) > monthKey)
    .sort((a, b) => a.from_month.localeCompare(b.from_month))[0];
  const next = later && Number(later.monthly_amount) !== amount
    ? { amount: Number(later.monthly_amount), month: later.from_month.slice(0, 7) }
    : null;
  return { amount, next };
}
