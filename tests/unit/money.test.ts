import { describe, expect, test } from "vitest";
import { monthStart, parsePaymentLines, reportRange, safeCell } from "@/lib/dispatch/money";

describe("pasted payment lines", () => {
  test("reads codes with optional amounts in common layouts", () => {
    const r = parsePaymentLines("Tracking\tAmount\tFee\nD16950069\t1,500.00\t20\nnov26002  Rs.450\nD16950070,500,0\n\nNOV26004;");
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { code: "D16950069", collected: 1500, fee: 20 },
      { code: "NOV26002", collected: 450 },
      { code: "D16950070", collected: 500, fee: 0 },
      { code: "NOV26004" },
    ]);
  });

  test("reports bad lines and duplicates with their line numbers", () => {
    const r = parsePaymentLines("D16950069 abc\nD16950069\nD16950069\n#$%");
    expect(r.rows).toEqual([{ code: "D16950069" }]);
    expect(r.errors.map((e) => [e.line, e.message])).toEqual([
      [1, "The amount is not a number"],
      [3, "Listed twice"],
      [4, "Not a tracking number or reference"],
    ]);
  });
});

test("spreadsheet cells can't start a formula", () => {
  expect(safeCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
  expect(safeCell("-5")).toBe("'-5");
  expect(safeCell("Round A")).toBe("Round A");
  expect(safeCell(-5)).toBe(-5);
  expect(safeCell(null)).toBe("");
});

test("month input", () => {
  expect(monthStart("2026-11")).toBe("2026-11-01");
  expect(monthStart("2026-13")).toBeNull();
  expect(monthStart("x")).toBeNull();
});

test("report range defaults to the last three months and puts the months in order", () => {
  const now = new Date(Date.UTC(2026, 10, 15));
  expect(reportRange(undefined, undefined, now)).toEqual({ from: "2026-09", to: "2026-11" });
  expect(reportRange("2026-12", "2026-01", now)).toEqual({ from: "2026-01", to: "2026-12" });
  expect(reportRange("bad", "2026-02", now)).toEqual({ from: "2026-02", to: "2026-09" });
});
