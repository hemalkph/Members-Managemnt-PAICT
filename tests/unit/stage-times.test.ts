import { describe, expect, test } from "vitest";
import {
  countdownText,
  defaultWindow,
  fromColomboISO,
  stageDeadline,
  stretchStages,
  toColomboISO,
  windowError,
} from "@/lib/papers/times";

const H = 3_600_000;
const ms = (iso: string) => Date.parse(iso);

describe("stage times", () => {
  test("default window", () => {
    expect(defaultWindow("2026-12-09")).toEqual({
      start: "2026-11-30T08:00:00+05:30",
      end: "2026-12-08T18:00:00+05:30",
    });
  });

  test("stretch keeps shape", () => {
    const { start, end } = defaultWindow("2026-12-09");
    const t = stretchStages(start, end, []);
    expect(t.create_si?.startAt).toBe("2026-11-30T08:00:00+05:30");
    expect(t.handover?.dueAt).toBe(end);
    expect(ms(t.typeset_si!.startAt)).toBeGreaterThanOrEqual(ms(t.create_si!.dueAt));
    expect(ms(t.review_si!.startAt)).toBeGreaterThanOrEqual(ms(t.typeset_si!.startAt));
    expect(t.scheme).toBeUndefined();
  });

  test("short window", () => {
    const t = stretchStages("2026-12-01T08:00:00+05:30", "2026-12-03T08:00:00+05:30", []);
    const order = ["create_si", "typeset_si", "typeset_en", "review_si", "handover"] as const;
    for (const s of order) expect(ms(t[s]!.dueAt)).toBeGreaterThan(ms(t[s]!.startAt));
    for (let i = 1; i < order.length; i++)
      expect(ms(t[order[i]]!.startAt)).toBeGreaterThanOrEqual(ms(t[order[i - 1]]!.startAt));
    // Rounded to whole hours in Sri Lanka time.
    expect(t.typeset_si!.startAt.slice(14, 19)).toBe("00:00");
  });

  test("skipped excluded", () => {
    const { start, end } = defaultWindow("2026-12-09");
    const t = stretchStages(start, end, ["convert", "typeset_en", "review_en"]);
    expect(t.convert).toBeUndefined();
    expect(t.typeset_si).toBeDefined();
  });

  test("window order", () => {
    expect(windowError("2026-12-08T18:00:00+05:30", "2026-12-01T08:00:00+05:30")).toBe(
      "The hand-over deadline must be after the start.",
    );
    expect(windowError("2026-12-01T08:00:00+05:30", "2026-12-08T18:00:00+05:30")).toBeNull();
  });

  test("countdown text", () => {
    const now = ms("2026-11-25T09:00:00+05:30");
    expect(countdownText(now + 52 * H, now)).toEqual({ text: "2 d 4 h left", late: false });
    expect(countdownText(now + 5 * H + 20 * 60_000, now)).toEqual({ text: "5 h 20 m left", late: false });
    expect(countdownText(now + 45 * 60_000, now)).toEqual({ text: "45 m left", late: false });
    expect(countdownText(now - 27 * H, now)).toEqual({ text: "Late 1 d 3 h", late: true });
  });

  test("no time falls back", () => {
    expect(stageDeadline(null, "2026-12-04")).toBe(ms("2026-12-04T23:59:00+05:30"));
    expect(stageDeadline("2026-12-04T18:00:00+05:30", "2026-12-04")).toBe(ms("2026-12-04T18:00:00+05:30"));
    expect(stageDeadline(null, null)).toBeNull();
  });

  test("colombo iso round trip", () => {
    expect(toColomboISO("2026-12-04", "18:30")).toBe("2026-12-04T18:30:00+05:30");
    expect(fromColomboISO("2026-12-04T13:00:00Z")).toEqual({ date: "2026-12-04", time: "18:30" });
  });
});
