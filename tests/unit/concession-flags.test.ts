import { describe, expect, test } from "vitest";
import { autoFlags, type StudentFacts } from "@/lib/students/flags";

const base: StudentFacts = {
  card: "half",
  status: "verified",
  createdOn: "2026-06-01",
  verifiedMonth: "2026-06",
  missing: [],
  exams: [],
  results: {},
  payments: { "2026-09": "paid", "2026-10": "paid" },
};
const TODAY = "2026-11-15";
const keys = (f: StudentFacts, month = "2026-11", today = TODAY) => autoFlags(f, month, today).map((x) => x.key);

describe("autoFlags", () => {
  test("a student with nothing wrong has no flags", () => {
    expect(keys(base)).toEqual([]);
  });

  test("ended students are never flagged", () => {
    expect(keys({ ...base, status: "ended", missing: ["GN certificate file"] })).toEqual([]);
  });

  test("missing paperwork is flagged after 14 days, not before", () => {
    expect(keys({ ...base, missing: ["GN certificate file"], createdOn: "2026-11-05" })).toEqual([]);
    expect(keys({ ...base, missing: ["Parent occupation"], createdOn: "2026-11-01" })).toEqual(["paperwork"]);
  });

  test("two absences in the month, or two exams in a row", () => {
    const exams = [
      { id: "a", date: "2026-10-20" },
      { id: "b", date: "2026-11-03" },
      { id: "c", date: "2026-11-10" },
    ];
    expect(keys({ ...base, exams, results: { a: { attendance: "present", percent: 70 }, b: { attendance: "absent", percent: null }, c: { attendance: "absent", percent: null } } })).toEqual(["absent"]);
    expect(keys({ ...base, exams: exams.slice(0, 2), results: { a: { attendance: "absent", percent: null }, b: { attendance: "absent", percent: null } } })).toEqual(["absent"]);
    expect(keys({ ...base, exams: exams.slice(0, 2), results: { a: { attendance: "absent", percent: null }, b: { attendance: "present", percent: 60 } } })).toEqual([]);
  });

  test("an exam later than today doesn't count yet", () => {
    expect(keys({ ...base, exams: [{ id: "x", date: "2026-11-28" }] })).toEqual([]);
  });

  test("unpaid two finished months in a row, only after verifying, never for Free cards", () => {
    expect(keys({ ...base, payments: { "2026-09": "unpaid" } })).toEqual(["unpaid"]);
    expect(keys({ ...base, payments: { "2026-09": "paid" } })).toEqual([]);
    expect(keys({ ...base, payments: {}, verifiedMonth: "2026-10" })).toEqual([]);
    expect(keys({ ...base, card: "free", payments: {} })).toEqual([]);
    // Looking back at September: July and August.
    expect(keys({ ...base, payments: { "2026-07": "paid" } }, "2026-09")).toEqual(["unpaid"]);
  });

  test("low marks, or a drop of 15 points against the 3-month average", () => {
    const exams = [
      { id: "s", date: "2026-09-10" },
      { id: "o", date: "2026-10-10" },
      { id: "n", date: "2026-11-10" },
    ];
    const r = (n: number) => ({ attendance: "present" as const, percent: n });
    expect(keys({ ...base, exams, results: { s: r(80), o: r(80), n: r(30) } })).toEqual(["low"]);
    expect(keys({ ...base, exams, results: { s: r(80), o: r(80), n: r(64) } })).toEqual(["drop"]);
    expect(keys({ ...base, exams, results: { s: r(80), o: r(80), n: r(66) } })).toEqual([]);
  });

  test("an old certificate and a missing result", () => {
    expect(keys({ ...base, missing: ["A certificate from the last 12 months"], exams: [{ id: "n", date: "2026-11-02" }] })).toEqual([
      "old-certificate",
      "no-result",
    ]);
  });

  test("exams before the student registered need no result", () => {
    expect(keys({ ...base, createdOn: "2026-11-05", exams: [{ id: "n", date: "2026-11-02" }] })).toEqual([]);
  });
});
