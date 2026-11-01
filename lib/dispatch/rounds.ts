import type { Database } from "@/lib/database.types";
import { makeT, plural, type T } from "./i18n";
import { closeReady, OPTIONAL_STEPS, type OptionalStep, type RoundProgress } from "./stages";

export type RoundState = Database["public"]["Tables"]["dispatch_rounds"]["Row"]["state"];

export const ROUND_STATE: Record<
  RoundState,
  { label: string; variant: "secondary" | "outline" | "success" | "warning" | "destructive" | "default" }
> = {
  draft: { label: "Draft", variant: "outline" },
  finalised: { label: "Finalised", variant: "warning" },
  active: { label: "Active", variant: "default" },
  closed: { label: "Closed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export type RoundCounts = {
  parcels: number;
  registered: number;
  voided: number;
  packed?: number;
  verified?: number;
  onHold?: number;
  handedOver?: number;
  delivered?: number;
  /** Failed deliveries (returned parcels are final and can be closed as they are). */
  problems?: number;
  returned?: number;
  /** From the close check, when known. */
  codOwing?: number;
  canClose?: boolean;
  /** Optional steps in use (all when not given). */
  steps?: OptionalStep[];
};

/** The next thing to do, worked out from what is actually saved. Pass `t` to translate it. */
export function nextStep(state: RoundState, c: RoundCounts, t: T = makeT("en")): string {
  if (state === "draft") return t("Finish the plan (tutes, students, contents), then finalise.");
  if (state === "cancelled") return t("This draft was cancelled.");
  if (state === "closed") return t("Closed.");
  const waiting = c.parcels - c.registered - c.voided;
  if (c.registered === 0) return t("Register the parcels with Citypak, then import their tracking sheet.");
  if (waiting > 0)
    return t(
      plural(
        waiting,
        "{n} parcel has no tracking number yet – import the Citypak sheet.",
        "{n} parcels have no tracking number yet – import the Citypak sheet.",
      ),
      { n: waiting },
    );
  const live = c.parcels - c.voided;
  if (c.onHold)
    return t(
      plural(
        c.onHold,
        "{n} parcel is on hold – sort them out on the Packing page.",
        "{n} parcels are on hold – sort them out on the Packing page.",
      ),
      { n: c.onHold },
    );
  const steps = c.steps ?? OPTIONAL_STEPS;
  // Without a handover step, packing is the last step before closing.
  if (!steps.includes("handover")) {
    if ((c.packed ?? 0) < live)
      return t("Pack the parcels at the packing station ({packed} of {live} packed).", { packed: c.packed ?? 0, live });
    return c.canClose
      ? t("Every parcel is packed – close the round.")
      : t("Every parcel is packed. Finish the checks, then close the round.");
  }
  const handed = c.handedOver ?? 0;
  if (!steps.includes("delivery") && live > 0 && handed === live)
    return t("Every parcel is with Citypak – close the round.");
  if (c.problems)
    return t(
      plural(
        c.problems,
        "{n} delivery failed – send it again, or mark it returned, on the Delivery page.",
        "{n} deliveries failed – send them again, or mark them returned, on the Delivery page.",
      ),
      { n: c.problems },
    );
  const finished = (c.delivered ?? 0) + (c.returned ?? 0);
  if (handed === live && finished === live) {
    if (!steps.includes("money")) return t("Everything is delivered or returned – close the round.");
    if (c.canClose) return t("Everything is delivered or returned and the COD is settled – close the round.");
    if (c.codOwing)
      return t(
        "Every parcel is delivered or returned. Rs. {amount} COD is still owed – record Citypak's settlement on the COD money page.",
        { amount: c.codOwing.toLocaleString("en-LK") },
      );
    return t("Every parcel is delivered or returned. Settle the COD, then close the round.");
  }
  if (handed === live)
    return t("Every parcel is with Citypak ({delivered} of {live} delivered). Update statuses on the Delivery page.", {
      delivered: c.delivered ?? 0,
      live,
    });
  if ((c.packed ?? 0) < live)
    return handed
      ? t("Pack the parcels at the packing station ({packed} of {live} packed, {handed} handed over).", {
          packed: c.packed ?? 0,
          live,
          handed,
        })
      : t("Pack the parcels at the packing station ({packed} of {live} packed).", { packed: c.packed ?? 0, live });
  return handed > 0
    ? t(
        plural(
          live - handed,
          "{n} packed parcel is still here – hand it to Citypak.",
          "{n} packed parcels are still here – hand them to Citypak.",
        ),
        { n: live - handed },
      )
    : t("Every parcel is packed. Hand them to Citypak on the Handover page.");
}

/** The counts nextStep needs, from a round's live progress. */
export function countsFromProgress(p: RoundProgress): RoundCounts {
  return {
    parcels: p.live,
    registered: p.registered,
    voided: 0,
    packed: p.packed,
    verified: p.verified,
    onHold: p.onHold,
    handedOver: p.handedOver,
    delivered: p.delivered,
    returned: p.returned,
    problems: p.failed,
    codOwing: p.codOwing,
    canClose: closeReady(p),
    steps: p.optional,
  };
}

export function monthLabelFromDate(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
