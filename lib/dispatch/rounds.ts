import type { Database } from "@/lib/database.types";

export type RoundState = Database["public"]["Tables"]["dispatch_rounds"]["Row"]["state"];

export const ROUND_STATE: Record<RoundState, { label: string; variant: "secondary" | "outline" | "success" | "warning" | "destructive" | "default" }> = {
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
};

/** The next thing to do, worked out from what is actually saved. */
export function nextStep(state: RoundState, c: RoundCounts): string {
  if (state === "draft") return "Finish the plan (tutes, students, contents), then finalise.";
  if (state === "cancelled") return "This draft was cancelled.";
  if (state === "closed") return "Closed.";
  const waiting = c.parcels - c.registered - c.voided;
  if (c.registered === 0) return "Register the parcels with Citypak, then import their tracking sheet.";
  if (waiting > 0) return `${waiting} parcel${waiting === 1 ? " has" : "s have"} no tracking number yet – import the Citypak sheet.`;
  const live = c.parcels - c.voided;
  if (c.onHold) return `${c.onHold} parcel${c.onHold === 1 ? " is" : "s are"} on hold – sort them out on the Packing page.`;
  const handed = c.handedOver ?? 0;
  if (c.problems) return `${c.problems} deliver${c.problems === 1 ? "y" : "ies"} failed – send ${c.problems === 1 ? "it" : "them"} again, or mark ${c.problems === 1 ? "it" : "them"} returned, on the Delivery page.`;
  const finished = (c.delivered ?? 0) + (c.returned ?? 0);
  if (handed === live && finished === live) {
    if (c.canClose) return "Everything is delivered or returned and the COD is settled – close the round.";
    if (c.codOwing) return `Every parcel is delivered or returned. Rs. ${c.codOwing.toLocaleString("en-LK")} COD is still owed – record Citypak's settlement on the COD money page.`;
    return "Every parcel is delivered or returned. Settle the COD, then close the round.";
  }
  if (handed === live) return `Every parcel is with Citypak (${c.delivered ?? 0} of ${live} delivered). Update statuses on the Delivery page.`;
  if ((c.packed ?? 0) < live) return `Pack the parcels at the packing station (${c.packed ?? 0} of ${live} packed${handed ? `, ${handed} handed over` : ""}).`;
  return handed > 0
    ? `${live - handed} packed parcel${live - handed === 1 ? " is" : "s are"} still here – hand ${live - handed === 1 ? "it" : "them"} to Citypak.`
    : "Every parcel is packed. Hand them to Citypak on the Handover page.";
}

export function monthLabelFromDate(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
