// The seven steps of a round, worked out from what is saved, and the one
// thing this person should do next. Pure, so it is unit tested.
import type { DispatchCapability } from "@/lib/database.types";

export type StageKey = "plan" | "tracking" | "pack" | "handover" | "delivery" | "money" | "close";
export type StageStatus = "done" | "now" | "started" | "later";

export type RoundProgress = {
  state: "draft" | "finalised" | "active" | "closed" | "cancelled";
  live: number;
  registered: number;
  packed: number;
  verified: number;
  onHold: number;
  handedOver: number;
  delivered: number;
  returned: number;
  failed: number;
  verification: boolean;
  /** COD still owed on delivered parcels, and parcels in a draft settlement (from the close check). */
  codOwing: number;
  inDraft: number;
};

export type Stage = {
  key: StageKey;
  label: string;
  status: StageStatus;
  /** e.g. "30 / 40" – empty when a count makes no sense. */
  count: string;
  href: string | null;
};

export type NextAction = { label: string; href: string } | null;

export const STAGE_LABEL: Record<StageKey, string> = {
  plan: "Plan",
  tracking: "Tracking numbers",
  pack: "Pack",
  handover: "Hand over",
  delivery: "Delivery",
  money: "COD money",
  close: "Close",
};

export const ACTION_LABEL: Record<StageKey, string> = {
  plan: "Continue planning",
  tracking: "Add tracking numbers",
  pack: "Open packing station",
  handover: "Start handover",
  delivery: "Update deliveries",
  money: "Record COD payment",
  close: "Close the round",
};

/** Ready for the courier = packed (and verified when the second check is on). */
const ready = (p: RoundProgress) => (p.verification ? p.verified : p.packed);

function isDone(key: StageKey, p: RoundProgress): boolean {
  const any = p.live > 0;
  switch (key) {
    case "plan":
      return p.state !== "draft" && p.state !== "cancelled";
    case "tracking":
      return any && p.registered >= p.live;
    case "pack":
      return any && ready(p) >= p.live;
    case "handover":
      return any && p.handedOver >= p.live;
    case "delivery":
      return any && p.delivered + p.returned >= p.live;
    case "money":
      return any && p.delivered + p.returned >= p.live && p.codOwing <= 0 && p.inDraft === 0;
    case "close":
      return p.state === "closed";
  }
}

/** Has this step got any work in it yet? (Steps can overlap: some parcels go out while others are still packed.) */
function hasProgress(key: StageKey, p: RoundProgress): boolean {
  switch (key) {
    case "tracking":
      return p.registered > 0;
    case "pack":
      return p.packed > 0;
    case "handover":
      return p.handedOver > 0;
    case "delivery":
      return p.delivered + p.returned + p.failed > 0;
    case "money":
      return p.delivered > 0;
    default:
      return false;
  }
}

/** Can work on this step start yet? */
function canStart(key: StageKey, p: RoundProgress): boolean {
  if (p.state === "closed" || p.state === "cancelled") return false;
  switch (key) {
    case "plan":
      return p.state === "draft";
    case "tracking":
      return p.state !== "draft" && p.registered < p.live;
    case "pack":
      return p.registered > ready(p) || (p.verification && p.packed > p.verified);
    case "handover":
      return ready(p) > p.handedOver;
    case "delivery":
      return p.handedOver > p.delivered + p.returned;
    case "money":
      return p.codOwing > 0 || p.inDraft > 0;
    case "close":
      return isDone("delivery", p) && isDone("money", p);
  }
}

function count(key: StageKey, p: RoundProgress): string {
  if (p.live === 0) return "";
  switch (key) {
    case "tracking":
      return `${p.registered} / ${p.live}`;
    case "pack":
      return `${ready(p)} / ${p.live}`;
    case "handover":
      return `${p.handedOver} / ${p.live}`;
    case "delivery":
      return `${p.delivered + p.returned} / ${p.live}`;
    default:
      return "";
  }
}

const KEYS: StageKey[] = ["plan", "tracking", "pack", "handover", "delivery", "money", "close"];

/** Which page each step opens for this person (null = they can't open it). */
function stageHref(key: StageKey, roundId: string, caps: ReadonlySet<DispatchCapability>): string | null {
  const base = `/admin/dispatch/rounds/${roundId}`;
  switch (key) {
    case "plan":
      return base;
    case "tracking":
      return caps.has("courier") ? `${base}/courier` : null;
    case "pack":
      return caps.has("pack") || caps.has("verify") ? `${base}/scan` : caps.has("plan") ? `${base}/packing` : null;
    case "handover":
      return caps.has("verify") ? `${base}/handover` : null;
    case "delivery":
      return caps.has("courier") ? `${base}/delivery` : null;
    case "money":
      return caps.has("finance") ? "/admin/dispatch/money" : null;
    case "close":
      return `${base}#close`;
  }
}

/** Who may do the main work of each step. */
const STAGE_CAP: Record<StageKey, DispatchCapability[]> = {
  plan: ["plan"],
  tracking: ["courier"],
  pack: ["pack", "verify"],
  handover: ["verify"],
  delivery: ["courier"],
  money: ["finance"],
  close: ["plan"],
};

export function roundStages(roundId: string, p: RoundProgress, caps: ReadonlySet<DispatchCapability>): Stage[] {
  let current: StageKey | null = null;
  return KEYS.map((key) => {
    const done = p.state === "closed" || isDone(key, p);
    let status: StageStatus;
    if (done) status = "done";
    else if (current === null && p.state !== "cancelled") {
      current = key;
      status = "now";
    } else status = hasProgress(key, p) ? "started" : "later";
    return {
      key,
      label: STAGE_LABEL[key],
      status,
      count: count(key, p),
      href: status === "later" ? null : stageHref(key, roundId, caps),
    };
  });
}

/**
 * The single next thing for this person: the first step that isn't done,
 * can be worked on now, and that they have the permission for.
 */
export function nextAction(roundId: string, p: RoundProgress, caps: ReadonlySet<DispatchCapability>): NextAction {
  for (const key of KEYS) {
    if (isDone(key, p) || !canStart(key, p)) continue;
    if (!STAGE_CAP[key].some((c) => caps.has(c))) continue;
    const href = stageHref(key, roundId, caps);
    if (href) return { label: ACTION_LABEL[key], href };
  }
  return null;
}

/** Who to wait for when this person can't do the current step. */
export const WAITING_FOR: Record<StageKey, string> = {
  plan: "Waiting for a planner.",
  tracking: "Waiting for the person who handles Citypak files.",
  pack: "Waiting for the packers.",
  handover: "Waiting for the person who does the handover.",
  delivery: "Waiting for delivery updates from Citypak.",
  money: "Waiting for finance to record Citypak's payment.",
  close: "Waiting for a planner to close the round.",
};

export function waitingFor(stages: Stage[]): string | null {
  const now = stages.find((s) => s.status === "now");
  return now ? WAITING_FOR[now.key] : null;
}
