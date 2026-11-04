import { describe, expect, test } from "vitest";
import { dateInColombo, periodDays, periodOfDay, periodRangeLabel } from "@/lib/month";

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

describe("salary period from a timestamp", () => {
  test.each([
    ["2026-11-05T10:00:00Z", "2026-10"], // 5 Nov → October's period
    ["2026-11-10T18:00:00Z", "2026-10"], // 10 Nov 23:30 in Sri Lanka
    ["2026-11-10T19:00:00Z", "2026-11"], // 11 Nov 00:30 in Sri Lanka
  ])("%s → %s", (iso, key) => {
    expect(periodOfDay(dateInColombo(iso))).toBe(key);
  });
});
