import { describe, expect, test } from "vitest";
import {
  checkPaidCountWarning,
  filterNewTutePairs,
  isPaidCountStale,
  paidProgressPct,
} from "@/lib/class-ops/helpers";

describe("paidProgressPct", () => {
  test("computes bounded percentage of expected students", () => {
    expect(paidProgressPct(null, 100)).toBe(0);
    expect(paidProgressPct(50, 0)).toBe(0);
    expect(paidProgressPct(103, 143)).toBe(72);
    expect(paidProgressPct(180, 143)).toBe(100);
  });
});

describe("isPaidCountStale", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");

  test("only flags classes in the current month", () => {
    expect(isPaidCountStale(null, false, now)).toBe(false);
    expect(isPaidCountStale("2026-10-01T00:00:00Z", false, now)).toBe(false);
  });

  test("flags missing or older-than-5-days counts in the current month", () => {
    expect(isPaidCountStale(null, true, now)).toBe(true);
    expect(isPaidCountStale("2026-11-21T10:00:00Z", true, now)).toBe(false);
    expect(isPaidCountStale("2026-11-18T11:00:00Z", true, now)).toBe(true);
  });
});

describe("checkPaidCountWarning", () => {
  test("warns when lower than current paid count", () => {
    expect(checkPaidCountWarning(12, 103, 143)).toContain("Lower than current 103");
    expect(checkPaidCountWarning(103, 103, 143)).toBeNull();
    expect(checkPaidCountWarning(120, 103, 143)).toBeNull();
  });

  test("warns when more than 2x last month (for established classes)", () => {
    expect(checkPaidCountWarning(300, 103, 143)).toContain("More than 2× last month");
    expect(checkPaidCountWarning(250, 103, 143)).toBeNull();
    // Small brand-new class (<10 last month) shouldn't falsely trigger 2x warning
    expect(checkPaidCountWarning(25, 5, 8)).toBeNull();
  });
});

describe("filterNewTutePairs", () => {
  test("dedupes inputs and skips already-scheduled pairs", () => {
    const existing = new Set(["c1:t1", "c2:t2"]);
    expect(filterNewTutePairs(["c1", "c1", "c2"], ["t1", "t2", "t2"], existing)).toEqual([
      { classId: "c1", tuteId: "t2" },
      { classId: "c2", tuteId: "t1" },
    ]);
  });
});
