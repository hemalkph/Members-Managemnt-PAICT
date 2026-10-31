import { describe, expect, test } from "vitest";
import { canVoid, deliveryMove, needsReason, receiptExtension, receiptLooksRight } from "@/lib/dispatch/delivery";

describe("delivery moves", () => {
  test.each([
    ["handed_over", "in_transit", "ok"],
    ["handed_over", "delivered", "ok"],
    ["in_transit", "failed", "ok"],
    ["failed", "in_transit", "ok"],
    ["failed", "failed", "no"],
    ["awaiting_pickup", "delivered", "no"],
    ["delivered", "returned", "correction"],
    ["returned", "delivered", "correction"],
    ["delivered", "delivered", "no"],
  ] as const)("%s → %s is %s", (from, to, want) => {
    expect(deliveryMove(from, to)).toBe(want);
  });

  test("failed, returned and corrections need a reason", () => {
    expect(needsReason("delivered", false)).toBe(false);
    expect(needsReason("failed", false)).toBe(true);
    expect(needsReason("returned", false)).toBe(true);
    expect(needsReason("delivered", true)).toBe(true);
  });
});

test("only parcels not with the courier can be voided", () => {
  const base = { registration_state: "registered", inOpenHandover: false };
  expect(canVoid({ ...base, delivery_state: "awaiting_pickup" })).toBe(true);
  expect(canVoid({ ...base, delivery_state: "returned" })).toBe(true);
  expect(canVoid({ ...base, delivery_state: "handed_over" })).toBe(false);
  expect(canVoid({ ...base, delivery_state: "awaiting_pickup", inOpenHandover: true })).toBe(false);
  expect(canVoid({ ...base, delivery_state: "failed", registration_state: "voided" })).toBe(false);
});

test("receipt files are checked by name and content", () => {
  expect(receiptExtension("Receipt.JPEG")).toBe("jpg");
  expect(receiptExtension("slip.pdf")).toBe("pdf");
  expect(receiptExtension("slip.exe")).toBeNull();
  expect(receiptLooksRight("png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe(true);
  expect(receiptLooksRight("jpg", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  expect(receiptLooksRight("pdf", new TextEncoder().encode("%PDF-1.7"))).toBe(true);
});
