import { describe, expect, test } from "vitest";
import { availabilityLabel, awayOn, freeFirst, nextWorkingDay, type DayOff } from "@/lib/team/availability";

const off = (userId: string, from: string, to: string): DayOff => ({ id: `${userId}-${from}`, userId, from, to, note: "" });
const days = [off("a", "2026-11-26", "2026-11-28")];

describe("availability", () => {
  test("away on", () => {
    expect(awayOn(days, "a", "2026-11-26")).not.toBeNull();
    expect(awayOn(days, "a", "2026-11-27")).not.toBeNull();
    expect(awayOn(days, "a", "2026-11-28")).not.toBeNull();
    expect(awayOn(days, "a", "2026-11-29")).toBeNull();
    expect(awayOn(days, "b", "2026-11-27")).toBeNull();
  });

  test("next working day skips the whole range", () => {
    expect(nextWorkingDay(days, "a", "2026-11-27")).toBe("2026-11-29");
  });

  test("adjacent ranges", () => {
    const both = [...days, off("a", "2026-11-29", "2026-11-30")];
    expect(nextWorkingDay(both, "a", "2026-11-26")).toBe("2026-12-01");
  });

  test("not away", () => {
    expect(nextWorkingDay(days, "a", "2026-11-25")).toBe("2026-11-25");
  });

  test("label", () => {
    expect(availabilityLabel(3, days, "a", "2026-11-25", "2026-12-01")).toBe("3 open · away 26–28 Nov");
    expect(availabilityLabel(3, days, "a", "2026-12-02", "2026-12-09")).toBe("3 open");
    expect(availabilityLabel(0, [off("a", "2026-11-26", "2026-11-26")], "a", "2026-11-25", "2026-12-01")).toBe(
      "0 open · away 26 Nov",
    );
    expect(availabilityLabel(1, [off("a", "2026-11-30", "2026-12-02")], "a", "2026-11-25", "2026-12-05")).toBe(
      "1 open · away 30 Nov – 2 Dec",
    );
  });

  test("free first", () => {
    const people = [
      { id: "a", name: "Away", open: 0 },
      { id: "b", name: "Busy", open: 5 },
      { id: "c", name: "Calm", open: 1 },
    ];
    expect(freeFirst(people, days, "2026-11-25", "2026-12-01").map((p) => p.id)).toEqual(["c", "b", "a"]);
  });
});
