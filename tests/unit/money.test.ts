import { describe, expect, test } from "vitest";
import { buildMoneyMonths, type CostRow, type IncomeRow } from "@/lib/money/build";
import { classFeeSchema } from "@/lib/core/validation";
import type { MonthSpend } from "@/lib/payments/analytics";

const income = (over: Partial<IncomeRow>): IncomeRow => ({
  class_id: "c1",
  class_name: "Grand Revision",
  batch_name: "2027 A/L",
  month: "2026-11-01",
  fee: 1500,
  paid: 3,
  free: 1,
  amount_total: null,
  income: 3000,
  income_source: "fee",
  ...over,
});

const cost = (month: string, printing: number, postage: number): CostRow => ({ month, printing, postage });
const staff = (key: string, spent: number): MonthSpend => ({ key, month: key, spent, pending: 0 });

describe("buildMoneyMonths", () => {
  test("missing fee is not counted as zero", () => {
    const [nov] = buildMoneyMonths(
      ["2026-11"],
      [income({}), income({ class_id: "c2", class_name: "Theory", fee: null, income: null, income_source: "no_fee" })],
      [],
      [],
      [],
    );
    expect(nov.income).toBe(3000);
    expect(nov.missingFees).toBe(1);
    expect(nov.classes.find((c) => c.classId === "c2")).toMatchObject({ income: null, source: "no_fee" });
  });

  test("profit is income minus staff, printing and postage", () => {
    const [nov] = buildMoneyMonths(
      ["2026-11"],
      [income({ income: 10000 })],
      [cost("2026-11-01", 1500, 500)],
      [staff("2026-11", 4000)],
      [],
    );
    expect(nov).toMatchObject({ income: 10000, staff: 4000, printing: 1500, postage: 500, profit: 4000 });
  });

  test("staffClosed follows closed months", () => {
    const months = buildMoneyMonths(["2026-10", "2026-11"], [], [], [], ["2026-10"]);
    expect(months.map((m) => [m.key, m.staffClosed])).toEqual([
      ["2026-10", true],
      ["2026-11", false],
    ]);
  });

  test("months with no rows still appear", () => {
    const keys = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
    const months = buildMoneyMonths(keys, [], [], [], []);
    expect(months.map((m) => m.key)).toEqual(keys);
    expect(months.every((m) => m.income === 0 && m.profit === 0 && m.classes.length === 0)).toBe(true);
  });
});

describe("classFeeSchema", () => {
  const base = { class_id: "6f1c2b8e-1d2a-4c3b-9a8e-2f1d3c4b5a69", from_month: "2026-11" };

  test("accepts a fee typed with commas or spaces", () => {
    expect(classFeeSchema.parse({ ...base, fee: "2,500" }).fee).toBe(2500);
    expect(classFeeSchema.parse({ ...base, fee: " 1 500.50 " }).fee).toBe(1500.5);
  });

  test("an empty or non-number fee is refused, never saved as 0", () => {
    expect(classFeeSchema.safeParse({ ...base, fee: "" }).success).toBe(false);
    expect(classFeeSchema.safeParse({ ...base, fee: "   " }).success).toBe(false);
    expect(classFeeSchema.safeParse({ ...base, fee: "abc" }).success).toBe(false);
    expect(classFeeSchema.safeParse({ ...base, fee: "-5" }).success).toBe(false);
  });
});
