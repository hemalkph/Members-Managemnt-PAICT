// Handover and delivery rules shared by the pages. The database enforces the
// same rules (handover_*, delivery_set); these only decide what to show.

export type DeliveryState = "awaiting_pickup" | "handed_over" | "in_transit" | "delivered" | "failed" | "returned";
export type SettableState = Exclude<DeliveryState, "awaiting_pickup" | "handed_over">;

export const DELIVERY: Record<DeliveryState, { label: string; variant: "secondary" | "outline" | "success" | "warning" | "destructive" | "default" }> = {
  awaiting_pickup: { label: "Waiting for pickup", variant: "outline" },
  handed_over: { label: "Handed over", variant: "secondary" },
  in_transit: { label: "On the way", variant: "default" },
  delivered: { label: "Delivered", variant: "success" },
  failed: { label: "Failed", variant: "warning" },
  returned: { label: "Returned", variant: "destructive" },
};

export const SETTABLE: SettableState[] = ["in_transit", "delivered", "failed", "returned"];

const FORWARD: Partial<Record<DeliveryState, SettableState[]>> = {
  handed_over: ["in_transit", "delivered", "failed", "returned"],
  in_transit: ["delivered", "failed", "returned"],
  failed: ["in_transit", "delivered", "returned"],
};

/** Can a parcel move from `from` to `to`? Changing a final state (delivered, returned) is a correction. */
export function deliveryMove(from: DeliveryState, to: SettableState): "ok" | "correction" | "no" {
  if (from === to) return "no";
  if (FORWARD[from]?.includes(to)) return "ok";
  if (from === "delivered" || from === "returned") return "correction";
  return "no";
}

/** Failed, returned and every correction need a reason. */
export function needsReason(to: SettableState, correction: boolean): boolean {
  return correction || to === "failed" || to === "returned";
}

/** Can the parcel be voided or sent again? (Before handover, or after it failed or came back.) */
export function canVoid(p: { delivery_state: DeliveryState; registration_state: string; inOpenHandover: boolean }): boolean {
  return p.registration_state !== "voided" && !p.inOpenHandover && ["awaiting_pickup", "failed", "returned"].includes(p.delivery_state);
}

export type HandoverScanResult = {
  result: "ok" | "duplicate" | "not_ready" | "wrong_round" | "unknown";
  message: string;
  reference?: string;
  parcel_id?: string;
  code?: string;
};

/** Receipts: photo or PDF, kept in their own folder. */
export const RECEIPT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function receiptExtension(fileName: string): "pdf" | "jpg" | "png" | "webp" | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "jpeg" || ext === "jpg") return "jpg";
  return ext === "pdf" || ext === "png" || ext === "webp" ? ext : null;
}

/** Does the file start like the type it claims to be? */
export function receiptLooksRight(ext: "pdf" | "jpg" | "png" | "webp", bytes: Uint8Array): boolean {
  const starts = (...b: number[]) => b.every((v, i) => bytes[i] === v);
  if (ext === "pdf") return starts(0x25, 0x50, 0x44, 0x46);
  if (ext === "jpg") return starts(0xff, 0xd8, 0xff);
  if (ext === "png") return starts(0x89, 0x50, 0x4e, 0x47);
  return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}
