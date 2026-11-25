import { describe, expect, test } from "vitest";
import { defaultSchedule, type PaperView, type StageView } from "@/lib/papers";
import { paperCountdown, sortCountdown, suggestOffsets, type StageStat } from "@/lib/papers/countdown";
import type { DayOff } from "@/lib/team/availability";

const today = "2026-11-25";

const st = (over: Partial<StageView> & Pick<StageView, "stage" | "position">): StageView => ({
  id: over.stage,
  ownerId: null,
  ownerName: null,
  startDate: null,
  dueDate: null,
  link: null,
  status: "waiting",
  completedAt: null,
  startedAt: null,
  overdue: false,
  ...over,
});

const paper = (stages: StageView[], over: Partial<PaperView> = {}): PaperView =>
  ({ id: "p", title: "Term test", status: "in_progress", examDay: "2026-12-02", stages, ...over }) as PaperView;

const flow = (over: Partial<Record<string, Partial<StageView>>> = {}) =>
  (
    [
      ["create_si", 1],
      ["typeset_si", 2],
      ["convert", 3],
      ["typeset_en", 4],
      ["review_si", 5],
      ["review_en", 6],
      ["handover", 7],
    ] as const
  ).map(([stage, position]) => st({ stage, position, ...over[stage] }));

describe("paperCountdown", () => {
  test("late stage", () => {
    const p = paper(
      flow({ create_si: { status: "done" }, typeset_si: { status: "in_progress", dueDate: "2026-11-23" } }),
    );
    const row = paperCountdown(p, "2026-12-02", today, [], []);
    expect(row).toMatchObject({ state: "late", daysLate: 2 });
    expect(row.blocking?.stage).toBe("typeset_si");
    expect(row.reason).toContain("2 days late");
  });

  test("exam today not ready", () => {
    const p = paper(flow({ create_si: { status: "done" }, handover: { status: "in_progress", dueDate: today } }));
    expect(paperCountdown(p, today, today, [], []).state).toBe("late");
  });

  test("ready", () => {
    const p = paper(flow({ handover: { status: "done" } }));
    const row = paperCountdown(p, "2026-12-02", today, [], []);
    expect(row.state).toBe("ready");
    expect(row.blocking).toBeNull();
  });

  test("at risk by duration", () => {
    const p = paper(
      flow({ create_si: { status: "in_progress", startedAt: `${today}T08:00:00+05:30`, dueDate: "2026-11-26" } }),
    );
    const stats: StageStat[] = [{ stage: "create_si", done: 5, late: 2, avgDaysLate: 1, medianDays: 4 }];
    expect(paperCountdown(p, "2026-12-02", today, stats, []).state).toBe("at_risk");
  });

  test("at risk by day off", () => {
    const p = paper(
      flow({
        create_si: { status: "in_progress", dueDate: "2026-11-27" },
        review_si: { ownerId: "nimal", ownerName: "Nimal", startDate: "2026-11-30", dueDate: "2026-12-01" },
      }),
    );
    const daysOff: DayOff[] = [{ id: "d", userId: "nimal", from: "2026-11-30", to: "2026-11-30", note: "" }];
    const row = paperCountdown(p, "2026-12-02", today, [], daysOff);
    expect(row.state).toBe("at_risk");
    expect(row.reason).toContain("Nimal");
    expect(row.reason).toContain("Review (Sinhala)");
  });

  test("skipped stages ignored", () => {
    const p = paper(
      flow({
        create_si: { status: "done" },
        convert: { status: "skipped", dueDate: "2026-11-01" },
        typeset_en: { status: "skipped" },
        review_en: { status: "skipped" },
        typeset_si: { status: "in_progress", dueDate: "2026-11-28" },
      }),
    );
    const row = paperCountdown(p, "2026-12-02", today, [], []);
    expect(row.state).toBe("on_track");
    expect(row.blocking?.stage).toBe("typeset_si");
  });

  test("no history", () => {
    const p = paper(flow({ create_si: { status: "in_progress", dueDate: "2026-11-26" } }));
    expect(paperCountdown(p, "2026-12-02", today, [], []).state).toBe("on_track");
  });

  test("sort", () => {
    const onTrack = paperCountdown(
      paper(flow({ create_si: { status: "in_progress", dueDate: "2026-11-28" } }), { id: "a" }),
      "2026-11-26",
      today,
      [],
      [],
    );
    const late = paperCountdown(
      paper(flow({ create_si: { status: "in_progress", dueDate: "2026-11-20" } }), { id: "b" }),
      "2026-11-27",
      today,
      [],
      [],
    );
    expect(sortCountdown([onTrack, late], today).map((r) => r.paper.id)).toEqual(["b", "a"]);
  });
});

describe("suggestOffsets", () => {
  test("suggestions", () => {
    const stats: StageStat[] = [
      { stage: "typeset_si", done: 8, late: 4, avgDaysLate: 2.3, medianDays: 2 },
      { stage: "create_si", done: 2, late: 2, avgDaysLate: 3, medianDays: 4 },
      { stage: "review_si", done: 9, late: 6, avgDaysLate: 0.5, medianDays: 1 },
    ];
    const s = suggestOffsets(stats, {});
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      stage: "typeset_si",
      earlierBy: 3,
      current: { start: -4, due: -3 },
      next: { start: -7, due: -3 },
    });
  });
});

test("defaultSchedule uses overrides", () => {
  expect(defaultSchedule("2026-12-02", { typeset_si: { start: -6, due: -3 } }).typeset_si).toEqual({
    start: "2026-11-26",
    due: "2026-11-29",
  });
});

test("an applied suggestion isn't offered again", () => {
  const stats: StageStat[] = [{ stage: "convert", done: 4, late: 3, avgDaysLate: 2.3, medianDays: 2 }];
  // Default convert start is -4; 3 earlier = -7 is already saved.
  expect(suggestOffsets(stats, { convert: { start: -7, due: -3 } })).toEqual([]);
  // A smaller move saved earlier: suggest the rest, counted from the default.
  expect(suggestOffsets(stats, { convert: { start: -5, due: -3 } })[0]).toMatchObject({
    current: { start: -5, due: -3 },
    next: { start: -7, due: -3 },
  });
});
