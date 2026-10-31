import type { Database } from "@/lib/database.types";

export type RoundState = Database["public"]["Tables"]["dispatch_rounds"]["Row"]["state"];

export const ROUND_STATE: Record<RoundState, { label: string; variant: "secondary" | "outline" | "success" | "warning" | "destructive" | "default" }> = {
  draft: { label: "Draft", variant: "outline" },
  finalised: { label: "Finalised", variant: "warning" },
  active: { label: "Active", variant: "default" },
  closed: { label: "Closed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export type RoundCounts = { parcels: number; registered: number; voided: number };

/** The next thing to do, worked out from what is actually saved. */
export function nextStep(state: RoundState, c: RoundCounts): string {
  if (state === "draft") return "Finish the plan (tutes, students, contents), then finalise.";
  if (state === "cancelled") return "This draft was cancelled.";
  if (state === "closed") return "Closed.";
  const waiting = c.parcels - c.registered - c.voided;
  if (c.registered === 0) return "Register the parcels with Citypak, then import their tracking sheet.";
  if (waiting > 0) return `${waiting} parcel${waiting === 1 ? " has" : "s have"} no tracking number yet – import the Citypak sheet.`;
  return "All parcels have tracking numbers. Packing comes in the next phase.";
}

export function monthLabelFromDate(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
