import { describe, expect, test } from "vitest";
import { parseCsv } from "@/lib/students/csv";
import {
  addDaysISO,
  bookletBadgeCode,
  bookletBadgeLines,
  defaultPrinterIdFor,
  formatPressOrderText,
  hallRemaining,
  historyToCsv,
  inferTuteKind,
  leftThisMonth,
  needSource,
  orderBreakdown,
  shelfVerdict,
} from "@/lib/tutes/helpers";
import type { TuteMove } from "@/lib/tutes/queries";

describe("leftThisMonth & hallRemaining", () => {
  test("leftThisMonth never goes negative", () => {
    expect(leftThisMonth({ need_this: 40, given_this: 15 })).toBe(25);
    expect(leftThisMonth({ need_this: 40, given_this: 45 })).toBe(0);
  });

  test("hallRemaining excludes online students when online > 0", () => {
    expect(hallRemaining({ expected: 100, online: 60, given: 50, hall_given: 15 })).toBe(25);
    expect(hallRemaining({ expected: 100, online: 60, given: 50, hall_given: 45 })).toBe(0);
    // Online-only class has 0 hall copies left
    expect(hallRemaining({ expected: 40, online: 40, given: 10, hall_given: 0 })).toBe(0);
  });

  test("hallRemaining falls back to total given when online is 0", () => {
    expect(hallRemaining({ expected: 50, online: 0, given: 20, hall_given: 0 })).toBe(30);
    expect(hallRemaining({ expected: 50, online: 0, given: 60, hall_given: 0 })).toBe(0);
  });
});

describe("addDaysISO", () => {
  test("handles month and year rollovers without timezone drift", () => {
    expect(addDaysISO("2026-04-28", 5)).toBe("2026-05-03");
    expect(addDaysISO("2026-12-30", 4)).toBe("2027-01-03");
    expect(addDaysISO("2028-02-27", 3)).toBe("2028-03-01"); // leap year
  });
});

describe("defaultPrinterIdFor", () => {
  const printers = [{ id: "p1" }, { id: "p2" }];

  test("prefers the tute's most recent active printer, then batch latest, then first active", () => {
    const jobs = [
      { tuteId: "t-other", printerId: "p1" },
      { tuteId: "t-1", printerId: "p2" },
    ];
    expect(defaultPrinterIdFor("t-1", jobs, printers)).toBe("p2");
    expect(defaultPrinterIdFor("t-new", jobs, printers)).toBe("p1");
    expect(defaultPrinterIdFor("t-new", [], printers)).toBe("p1");
  });

  test("skips inactive printers and returns 'none' if no active printers exist", () => {
    const jobs = [{ tuteId: "t-1", printerId: "p-inactive" }];
    expect(defaultPrinterIdFor("t-1", jobs, printers)).toBe("p1");
    expect(defaultPrinterIdFor("t-1", jobs, [])).toBe("none");
  });
});

describe("formatPressOrderText", () => {
  test("returns empty string when nothing needs printing", () => {
    expect(
      formatPressOrderText(
        [{ name: "Unit 01", code: "U01", pages: 20, print_now: 0, print_by: null }],
        "2026-05",
        "2026-05-10",
      ),
    ).toBe("");
  });

  test("formats WhatsApp-ready press order with urgent flags, codes, and page counts", () => {
    const text = formatPressOrderText(
      [
        { name: "Unit 07 - Database", code: "U07", pages: 40, print_now: 120, print_by: "2026-05-08" },
        { name: "Unit 08 - Networking", code: "", pages: null, print_now: 80, print_by: "2026-05-20" },
        { name: "Covered Tute", code: "U09", pages: 10, print_now: 0, print_by: null },
      ],
      "2026-05",
      "2026-05-10",
    );
    expect(text).toContain("Print Order — May 2026 (2 tutes, 200 copies)");
    expect(text).toContain("1. Unit 07 - Database [U07] (40 pages) — 120 copies — URGENT");
    expect(text).toContain("2. Unit 08 - Networking — 80 copies — by 20 May 2026");
    expect(text).not.toContain("Covered Tute");
  });
});

describe("historyToCsv", () => {
  test("produces spreadsheet-safe UTF-8 CSV with headers, signs, Sinhala Unicode, and comma escaping", () => {
    const moves: TuteMove[] = [
      {
        id: "m1",
        tuteId: "t1",
        tuteName: "ඒකකය 07, නිබන්ධනය",
        qty: 50,
        kind: "print_in",
        className: null,
        month: null,
        note: 'Box 1 "front"',
        flag: "",
        by: "Nimal",
        createdAt: "2026-05-10T09:30:00Z",
      },
      {
        id: "m2",
        tuteId: "t1",
        tuteName: "Unit 07",
        qty: -12,
        kind: "count_fix",
        className: "2026 Theory",
        month: "2026-05-01",
        note: "Recounted shelf",
        flag: "Count is 12 below the record",
        by: "Kamal",
        createdAt: "2026-05-11T10:00:00Z",
      },
    ];

    const csv = historyToCsv(moves);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const parsed = parseCsv(csv);
    expect(parsed[0]).toEqual(["When", "Tute", "Change", "Type", "Class", "Month", "Note", "Odd Flag", "By"]);
    expect(parsed[1][1]).toBe("ඒකකය 07, නිබන්ධනය");
    expect(parsed[1][2]).toBe("+50");
    expect(parsed[1][3]).toBe("Printed");
    expect(parsed[1][6]).toBe('Box 1 "front"');
    expect(parsed[2][2]).toBe("-12");
    expect(parsed[2][3]).toBe("Count fix");
    expect(parsed[2][4]).toBe("2026 Theory");
    expect(parsed[2][5]).toBe("May 2026");
    expect(parsed[2][7]).toBe("Count is 12 below the record");
  });
});

describe("inferTuteKind, bookletBadgeCode & shelfVerdict", () => {
  test("classifies booklets by title and code accurately", () => {
    expect(inferTuteKind("Introduction to ICT - Short Note", "L01-SN")).toBe("note");
    expect(inferTuteKind("2022 Western Provincial Paper Discussion", "2022WP")).toBe("paper");
    expect(inferTuteKind("First Term Test Question Book", "28TTQB")).toBe("book");
    expect(inferTuteKind("Unit 07 - Database Systems", "U07")).toBe("tute");
  });

  test("derives clean compact booklet codes with or without explicit code", () => {
    expect(bookletBadgeCode("2023NWP", "2023 North-Western Provincial")).toBe("2023NWP");
    expect(bookletBadgeCode("", "Unit 7 - Databases")).toBe("U07");
    expect(bookletBadgeCode("", "Database Systems")).toBe("DS");
    expect(bookletBadgeLines("2022WP", "2022 Western Provincial")).toEqual(["2022", "WP"]);
    expect(bookletBadgeLines("2023NWP", "2023 North-Western Provincial")).toEqual(["2023", "NWP"]);
    expect(bookletBadgeLines("L01-SN", "Introduction to ICT")).toEqual(["L01", "SN"]);
    expect(bookletBadgeLines("28TTQB", "First Term Test Question Book")).toEqual(["28", "TTQB"]);
    expect(bookletBadgeLines("U07", "Unit 07")).toEqual(["U07", null]);
  });

  test("produces clear one-glance verdicts for each shelf state", () => {
    expect(
      shelfVerdict({ status: "not_counted", on_hand: 0, in_print: 0, need_this: 143, given_this: 0, need_next: 0, print_now: 150 }),
    ).toEqual({ label: "Needs shelf count", tone: "muted" });

    expect(
      shelfVerdict({ status: "out", on_hand: 0, in_print: 0, need_this: 143, given_this: 0, need_next: 0, print_now: 150 }),
    ).toEqual({ label: "Short 143", tone: "destructive" });

    expect(
      shelfVerdict({ status: "low", on_hand: 40, in_print: 110, need_this: 143, given_this: 0, need_next: 0, print_now: 0 }),
    ).toEqual({ label: "+110 at press", tone: "info" });

    expect(
      shelfVerdict({ status: "ok", on_hand: 180, in_print: 0, need_this: 143, given_this: 0, need_next: 0, print_now: 0 }),
    ).toEqual({ label: "Ready · 37 spare", tone: "success" });

    expect(
      shelfVerdict({ status: "ok", on_hand: 25, in_print: 0, need_this: 143, given_this: 143, need_next: 0, print_now: 0 }),
    ).toEqual({ label: "Done · 25 spare", tone: "success" });
  });
});

describe("needSource & orderBreakdown", () => {
  test("says where a class's expected students come from", () => {
    expect(needSource({ expected: 103, paid: 103, pace: null, method: "last_month" })).toBe("the paid list");
    expect(needSource({ expected: 143, paid: 103, pace: null, method: "last_month" })).toBe(
      "forecast (same as last month) · 103 paid so far",
    );
    expect(needSource({ expected: 120, paid: 60, pace: 120, method: "avg3" })).toBe(
      "month-end estimate from payment pace · 60 paid so far",
    );
    expect(needSource({ expected: 40, paid: null, pace: null, method: "trend" })).toBe("forecast (trend)");
  });

  test("spells out the Order number", () => {
    const base = { need_this: 143, given_this: 0, need_next: 0, safety: 8, loss_extra: 0, on_hand: 0, in_print: 0, print_batch: 1 };
    expect(orderBreakdown({ ...base, print_now: 151 })).toBe("143 still to give + 8 spare = 151");
    expect(orderBreakdown({ ...base, on_hand: 20, in_print: 10, print_batch: 25, print_now: 125 })).toBe(
      "143 still to give + 8 spare − 20 on shelf − 10 at press = 125 (121, rounded up to batches of 25)",
    );
  });
});
