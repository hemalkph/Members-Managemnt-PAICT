import { afterEach, describe, expect, test, vi } from "vitest";
import { periodProgress } from "@/lib/core/month";
import { paidFrom, salariesInEffect, salaryNowAndNext } from "@/lib/core/salary";

const row = (from_month: string, monthly_amount: number, role_id = "r1") => ({
  user_id: "u1",
  role_id,
  from_month,
  monthly_amount,
});

describe("salary in effect (same rule as public.close_pay_month)", () => {
  const rows = [row("2026-09-01", 20000), row("2026-11-01", 25000), row("2026-10-01", 5000, "r2")];

  test("a month pays the latest amount set from that month or before", () => {
    expect(salariesInEffect(rows, "2026-08")).toEqual([]);
    expect(salariesInEffect(rows, "2026-10").map((r) => r.monthly_amount).sort()).toEqual([20000, 5000]);
    expect(salariesInEffect(rows, "2026-11").find((r) => r.role_id === "r1")?.monthly_amount).toBe(25000);
  });

  test("now and the next change", () => {
    const mine = rows.filter((r) => r.role_id === "r1");
    expect(salaryNowAndNext(mine, "2026-10")).toEqual({ amount: 20000, next: { amount: 25000, month: "2026-11" } });
    expect(salaryNowAndNext(mine, "2026-11")).toEqual({ amount: 25000, next: null });
    expect(salaryNowAndNext([], "2026-11")).toEqual({ amount: 0, next: null });
  });

  test("pay start month", () => {
    expect(paidFrom(null, "2026-10")).toBe(true);
    expect(paidFrom("2026-11-01", "2026-10")).toBe(false);
    expect(paidFrom("2026-11-01", "2026-11")).toBe(true);
  });
});

describe("day in the pay period", () => {
  afterEach(() => vi.useRealTimers());

  test.each([
    ["2026-11-09T06:00:00Z", "2026-10", { day: 30, days: 31 }], // 9 Nov in October's period
    ["2026-10-11T06:00:00Z", "2026-10", { day: 1, days: 31 }],
    ["2026-11-09T06:00:00Z", "2026-11", { day: 0, days: 30 }], // November hasn't started
    ["2027-03-10T06:00:00Z", "2027-02", { day: 28, days: 28 }],
  ])("on %s, %s is %o", (now, key, expected) => {
    vi.useFakeTimers({ now: new Date(now) });
    expect(periodProgress(key)).toEqual(expected);
  });
});
