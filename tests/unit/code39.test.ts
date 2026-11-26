import { describe, expect, test } from "vitest";
import { CODE39, code39Bars } from "@/lib/payments/code39";

describe("code39", () => {
  test("every pattern has 9 elements, exactly 3 wide, and is unique", () => {
    const patterns = Object.values(CODE39);
    for (const p of patterns) {
      expect(p).toMatch(/^[01]{9}$/);
      expect(p.split("").filter((c) => c === "1")).toHaveLength(3);
    }
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  test("bars start and end with the * start/stop character", () => {
    const bars = code39Bars("A");
    // * A * : 3 characters × 5 bars each.
    expect(bars).toHaveLength(15);
    expect(bars[0].x).toBe(0);
    // Each character is 3 wide (×3) + 6 narrow (×1) = 15 units, plus 1 narrow gap between characters.
    const last = bars[bars.length - 1];
    expect(last.x + last.w).toBe(15 * 3 + 2);
  });

  test("lowercase is upper-cased and unsupported characters are dropped", () => {
    expect(code39Bars("ps-1")).toEqual(code39Bars("PS-1"));
    expect(code39Bars("P#S")).toEqual(code39Bars("PS"));
  });
});
