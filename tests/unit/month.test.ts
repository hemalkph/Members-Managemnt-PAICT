import { describe, expect, test } from "vitest";
import { periodDays, periodOfDay, periodRangeLabel } from "@/lib/month";

describe("pay months run 11th → 10th (same rule as public.pay_period_of)", () => {
  test.each([
    ["2026-10-11", "2026-10"],
    ["2026-11-10", "2026-10"],
    ["2026-11-11", "2026-11"],
    ["2027-01-05", "2026-12"],
  ])("%s is in %s", (day, month) => expect(periodOfDay(day)).toBe(month));

  test("October's period and label", () => {
    expect(periodDays("2026-10")).toEqual({ first: "2026-10-11", last: "2026-11-10" });
    expect(periodDays("2026-12")).toEqual({ first: "2026-12-11", last: "2027-01-10" });
    expect(periodRangeLabel("2026-10")).toBe("11 Oct – 10 Nov 2026");
  });
});
