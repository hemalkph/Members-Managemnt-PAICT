import { describe, expect, test } from "vitest";
import type { DispatchCapability } from "@/lib/database.types";
import { nextAction, roundStages, waitingFor, type RoundProgress } from "@/lib/dispatch/stages";

const base: RoundProgress = {
  state: "active",
  live: 10,
  registered: 10,
  packed: 0,
  verified: 0,
  onHold: 0,
  handedOver: 0,
  delivered: 0,
  returned: 0,
  failed: 0,
  verification: true,
  codOwing: 0,
  inDraft: 0,
  optional: ["handover", "delivery", "money"],
};
const caps = (...c: DispatchCapability[]) => new Set<DispatchCapability>(c);
const all = caps("plan", "courier", "pack", "verify", "correct", "finance");
const statuses = (p: RoundProgress) => roundStages("r1", p, all).map((s) => `${s.key}:${s.status}`);

describe("round steps", () => {
  test("a draft is at Plan", () => {
    expect(statuses({ ...base, state: "draft", live: 0, registered: 0 })[0]).toBe("plan:now");
    expect(nextAction("r1", { ...base, state: "draft", live: 0, registered: 0 }, all)?.label).toBe("Continue planning");
  });

  test("tracking, then packing; steps can overlap", () => {
    const p = { ...base, registered: 6, packed: 3, verified: 2 };
    expect(statuses(p)).toEqual([
      "plan:done",
      "tracking:now",
      "pack:started",
      "handover:later",
      "delivery:later",
      "money:later",
      "close:later",
    ]);
    // A planner+courier adds tracking; a packer packs what has tracking.
    expect(nextAction("r1", p, all)?.label).toBe("Add tracking numbers");
    expect(nextAction("r1", p, caps("pack"))).toEqual({
      label: "Open packing station",
      href: "/admin/dispatch/rounds/r1/scan",
    });
  });

  test("hand over, deliver, settle, close", () => {
    expect(nextAction("r1", { ...base, packed: 10, verified: 10 }, all)?.label).toBe("Start handover");
    const out = { ...base, packed: 10, verified: 10, handedOver: 10, delivered: 9, returned: 1, codOwing: 500 };
    expect(statuses(out).slice(3)).toEqual(["handover:done", "delivery:done", "money:now", "close:later"]);
    expect(nextAction("r1", out, all)?.label).toBe("Record COD payment");
    const settled = { ...out, codOwing: 0 };
    expect(nextAction("r1", settled, all)).toEqual({
      label: "Close the round",
      href: "/admin/dispatch/rounds/r1#close",
    });
    expect(statuses({ ...settled, state: "closed" }).every((s) => s.endsWith(":done"))).toBe(true);
  });

  test("without verification, packed is ready", () => {
    expect(nextAction("r1", { ...base, packed: 10, verification: false }, caps("verify"))?.label).toBe(
      "Start handover",
    );
  });

  test("someone without the permission is told who to wait for", () => {
    const p = { ...base, registered: 0 };
    expect(nextAction("r1", p, caps("finance"))).toBeNull();
    expect(waitingFor(roundStages("r1", p, caps("finance")))).toBe("Waiting for the person who handles Citypak files.");
  });

  test("steps a person can't open have no link", () => {
    const s = roundStages("r1", { ...base, packed: 4 }, caps("pack"));
    expect(s.find((x) => x.key === "tracking")?.href).toBeNull();
    expect(s.find((x) => x.key === "pack")?.href).toBe("/admin/dispatch/rounds/r1/scan");
  });
});

describe("offices that use fewer steps", () => {
  const short = { ...base, optional: [] as RoundProgress["optional"] };

  test("Plan → Tracking → Pack → Close", () => {
    expect(roundStages("r1", short, all).map((s) => s.key)).toEqual(["plan", "tracking", "pack", "close"]);
    const packed = { ...short, packed: 10, verified: 10 };
    expect(statuses(packed)).toEqual(["plan:done", "tracking:done", "pack:done", "close:now"]);
    expect(nextAction("r1", packed, all)?.label).toBe("Close the round");
    expect(nextAction("r1", { ...short, packed: 10, verified: 4 }, all)?.label).toBe("Open packing station");
  });

  test("handover without delivery or COD closes once everything is handed over", () => {
    const p = { ...base, optional: ["handover"] as RoundProgress["optional"], packed: 10, verified: 10, handedOver: 10 };
    expect(statuses(p)).toEqual(["plan:done", "tracking:done", "pack:done", "handover:done", "close:now"]);
    expect(nextAction("r1", p, all)?.label).toBe("Close the round");
  });

  test("each step reports how much of it is done", () => {
    const p = { ...base, registered: 5 };
    expect(roundStages("r1", p, all).find((s) => s.key === "tracking")?.share).toBe(0.5);
  });
});

