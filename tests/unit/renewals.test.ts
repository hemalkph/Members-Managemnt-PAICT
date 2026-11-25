import { describe, expect, test } from "vitest";
import type { ComparedStudent, FeeComparisonResult, MonthStudentRow } from "@/lib/fees/compare";
import { buildRenewalCard, findMovedClass, inReminderQueue, needsCall, targetShare } from "@/lib/fees/renewals";
import type { FeeFollowupStatus } from "@/lib/supabase/database.types";

const now = new Date("2026-11-25T09:00:00+05:30");
const today = "2026-11-25";

type CallFields = Parameters<typeof needsCall>[0];
const due = (over: Partial<CallFields> = {}): CallFields => ({
  kind: "due",
  followupStatus: "messaged",
  messageCount: 2,
  lastMessagedAt: "2026-11-22T10:00:00+05:30",
  lastCalledAt: null,
  promisedBy: null,
  ...over,
});

const student = (over: Partial<ComparedStudent>): ComparedStudent =>
  ({
    studentKey: "k",
    kind: "due",
    fullName: "Kasun Silva",
    whatsappNorm: null,
    mobileNorm: null,
    followupStatus: "pending",
    messageCount: 0,
    lastMessagedAt: null,
    lastCalledAt: null,
    promisedBy: null,
    callCount: 0,
    reason: "",
    movedToClassId: null,
    ...over,
  }) as ComparedStudent;

const listRow = (over: Partial<MonthStudentRow>): MonthStudentRow => ({
  id: "r",
  studentKey: "s",
  fullName: "",
  emailNorm: "",
  rawEmail: "",
  whatsappNorm: null,
  rawWhatsapp: "",
  mobileNorm: null,
  rawMobile: "",
  institute: "",
  district: "",
  isNewStudent: false,
  amount: null,
  exportLabel: "",
  rawClasses: "",
  ...over,
});

describe("needsCall", () => {
  test("paid student never needs a call", () => {
    expect(needsCall(due({ kind: "paid", messageCount: 5 }), now, today)).toBe(false);
  });

  test("two messages and two days", () => {
    expect(needsCall(due(), now, today)).toBe(true);
    expect(needsCall(due({ lastMessagedAt: "2026-11-24T10:00:00+05:30" }), now, today)).toBe(false);
    expect(needsCall(due({ messageCount: 1 }), now, today)).toBe(false);
    expect(needsCall(due({ lastCalledAt: "2026-11-24T20:00:00+05:30" }), now, today)).toBe(false);
    expect(needsCall(due({ lastCalledAt: "2026-11-24T08:00:00+05:30" }), now, today)).toBe(true);
  });

  test("passed promise needs a call", () => {
    expect(needsCall(due({ followupStatus: "promised", promisedBy: "2026-11-24" }), now, today)).toBe(true);
    expect(needsCall(due({ followupStatus: "promised", promisedBy: "2026-11-25" }), now, today)).toBe(false);
  });

  test("closed statuses never need a call", () => {
    for (const s of ["excused", "dropped", "cant_afford", "moved_class"] as FeeFollowupStatus[]) {
      expect(needsCall(due({ followupStatus: s, messageCount: 3 }), now, today)).toBe(false);
    }
  });
});

test("target line", () => {
  expect(targetShare(1, 10, 90)).toBe(0);
  expect(targetShare(10, 10, 90)).toBe(90);
  expect(targetShare(20, 10, 90)).toBe(90);
  expect(targetShare(5, 10, 90)).toBe(40);
  expect(targetShare(1, 1, 90)).toBe(90);
});

test("moved class by phone or name", () => {
  const others = [
    {
      classId: "b",
      className: "Theory",
      students: [
        listRow({ fullName: "Kasun Silva", whatsappNorm: "94771234567" }),
        listRow({ fullName: "Nimal Perera" }),
        listRow({ fullName: "Ann" }),
      ],
    },
  ];
  expect(findMovedClass({ fullName: "Kasun Silva", whatsappNorm: null, mobileNorm: "94771234567" }, others)).toEqual({
    classId: "b",
    className: "Theory",
  });
  expect(findMovedClass({ fullName: "Ruwan Fernando", whatsappNorm: "94771234567", mobileNorm: null }, others)).toBeNull();
  expect(findMovedClass({ fullName: "Nimal  Perera", whatsappNorm: null, mobileNorm: null }, others)).toEqual({
    classId: "b",
    className: "Theory",
  });
  expect(findMovedClass({ fullName: "Ann", whatsappNorm: null, mobileNorm: null }, others)).toBeNull();
});

describe("buildRenewalCard", () => {
  const result = (prevCount: number, rows: ComparedStudent[], paidBothCount = 6, newCount = 2) =>
    ({
      rows,
      summary: { prevCount, paidBothCount, newCount },
    }) as unknown as FeeComparisonResult;
  const threeDaysAgo = "2026-11-22T08:00:00+05:30";
  const rows = [
    student({ studentKey: "a", followupStatus: "excused" }),
    student({ studentKey: "b", followupStatus: "promised", promisedBy: "2026-11-28" }),
    student({ studentKey: "c", followupStatus: "messaged", messageCount: 2, lastMessagedAt: threeDaysAgo }),
    student({ studentKey: "d", followupStatus: "messaged", messageCount: 2, lastMessagedAt: "2026-11-21T08:00:00+05:30" }),
    student({ studentKey: "p", kind: "paid" }),
  ];
  const base = { classId: "a", className: "Grand Revision", batchName: "2027 A/L", now, today };

  test("card numbers", () => {
    const card = buildRenewalCard({ ...base, result: result(10, rows), fee: 3000 });
    expect(card).toMatchObject({ prevTotal: 10, renewed: 6, renewedPct: 60, fresh: 2, unpaid: 4, open: 3, moneyAtRisk: 9000 });
    expect(card.callList.map((r) => r.studentKey)).toEqual(["d", "c"]);
    expect(card.outcomes).toMatchObject({ excused: 1, promised: 1, messaged: 2 });
    expect(buildRenewalCard({ ...base, result: result(10, rows), fee: null }).moneyAtRisk).toBeNull();
  });

  test("no previous list", () => {
    const card = buildRenewalCard({ ...base, result: result(0, [], 0, 5), fee: 3000 });
    expect(card).toMatchObject({ prevTotal: 0, renewedPct: null, unpaid: 0, open: 0, moneyAtRisk: 0 });
  });
});

describe("inReminderQueue", () => {
  const row = (followupStatus: FeeFollowupStatus, contactPhoneChanged = false) =>
    student({ followupStatus, contactPhoneChanged });

  test("a student who promised to pay is not re-messaged by default", () => {
    expect(inReminderQueue(row("pending"), false)).toBe(true);
    expect(inReminderQueue(row("messaged"), false)).toBe(false);
    expect(inReminderQueue(row("promised"), false)).toBe(false);
    expect(inReminderQueue(row("promised"), true)).toBe(true);
    expect(inReminderQueue(row("promised", true), false)).toBe(true);
  });

  test("closed outcomes and paid students never get reminders", () => {
    for (const s of ["excused", "dropped", "cant_afford", "moved_class"] as FeeFollowupStatus[]) {
      expect(inReminderQueue(row(s), true)).toBe(false);
    }
    expect(inReminderQueue(student({ kind: "paid" }), true)).toBe(false);
  });
});
