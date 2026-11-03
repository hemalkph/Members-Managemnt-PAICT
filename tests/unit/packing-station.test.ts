import { describe, expect, test } from "vitest";
import { greeting, isMilestone, paceMinutes, speechText, tuteColor, TUTE_COLORS, workStart } from "@/lib/dispatch/station";

const MIN = 60_000;

describe("pace", () => {
  test("needs 3 confirms before guessing", () => {
    expect(paceMinutes([0, MIN], 10)).toBeNull();
  });
  test("one parcel a minute, 20 left → 20 minutes", () => {
    expect(paceMinutes([0, MIN, 2 * MIN, 3 * MIN], 20)).toBe(20);
  });
  test("a break of 5+ minutes doesn't slow the estimate", () => {
    expect(paceMinutes([0, MIN, 2 * MIN, 30 * MIN, 31 * MIN], 10)).toBe(10);
  });
  test("nothing left → no estimate", () => {
    expect(paceMinutes([0, MIN, 2 * MIN], 0)).toBeNull();
  });
});

describe("work stretch for the break reminder", () => {
  test("starts again after a 10-minute gap", () => {
    expect(workStart([0, MIN, 20 * MIN, 21 * MIN])).toBe(20 * MIN);
    expect(workStart([])).toBeNull();
  });
});

test("milestones every 25", () => {
  expect([0, 24, 25, 26, 50].map(isMilestone)).toEqual([false, false, true, false, true]);
});

test("greeting by the hour", () => {
  expect([6, 13, 19].map(greeting)).toEqual(["Good morning", "Good afternoon", "Good evening"]);
});

test("each tute keeps its colour by round order; unknown codes still get one", () => {
  const codes = ["T01", "T02", "T03"];
  expect(tuteColor("T02", codes)).toBe(TUTE_COLORS[1]);
  expect(TUTE_COLORS).toContain(tuteColor("X99", codes));
});

test("read-aloud text", () => {
  const items = [
    { code: "T06", qty: 2 },
    { code: "T07", qty: 1 },
  ];
  expect(speechText(items, "en")).toBe("T06, 2 copies. T07, 1 copy");
  expect(speechText(items, "si")).toBe("T06, පිටපත් 2. T07, පිටපත් 1");
});
