import { describe, expect, test } from "vitest";
import { missingItems, resultTotal, twelveMonthsBefore } from "@/lib/students/rules";

const complete = {
  card: "half" as const,
  files: 1,
  guardians: 1,
  gnDivision: "Maharagama 528",
  certificateIssuedOn: "2026-06-01",
  consentOn: "2026-06-02",
  monthlyAmount: 1500,
  today: "2026-11-15",
};

describe("missingItems", () => {
  test("a complete student is ready", () => {
    expect(missingItems(complete)).toEqual([]);
  });
  test("lists everything, in the database's order", () => {
    expect(
      missingItems({ ...complete, files: 0, guardians: 0, gnDivision: "", certificateIssuedOn: null, consentOn: null, monthlyAmount: null }),
    ).toEqual(["GN certificate file", "GN division", "Certificate date", "Parent occupation", "Parents' consent", "Monthly amount"]);
  });
  test("a Free card needs no amount", () => {
    expect(missingItems({ ...complete, card: "free", monthlyAmount: null })).toEqual([]);
  });
  test("a certificate older than 12 months is not enough", () => {
    expect(missingItems({ ...complete, certificateIssuedOn: "2025-11-14" })).toEqual(["A certificate from the last 12 months"]);
    expect(missingItems({ ...complete, certificateIssuedOn: "2025-11-15" })).toEqual([]);
  });
});

test("twelveMonthsBefore handles 29 February like Postgres", () => {
  expect(twelveMonthsBefore("2028-02-29")).toBe("2027-02-28");
  expect(twelveMonthsBefore("2026-11-15")).toBe("2025-11-15");
});

describe("resultTotal", () => {
  const parts = [
    { id: "a", maxMarks: 40 },
    { id: "b", maxMarks: 60 },
  ];
  test("adds the parts and gives a percentage of the whole exam", () => {
    expect(resultTotal(parts, { a: 35, b: 48.5 })).toEqual({ total: 83.5, max: 100, percent: 83.5, complete: true });
  });
  test("a missing part is not complete", () => {
    expect(resultTotal(parts, { a: 20 })).toEqual({ total: 20, max: 100, percent: 20, complete: false });
  });
  test("no marks at all", () => {
    expect(resultTotal(parts, {})).toEqual({ total: null, max: 100, percent: null, complete: false });
  });
});
