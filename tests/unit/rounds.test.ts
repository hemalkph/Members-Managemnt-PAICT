import { expect, test } from "vitest";
import { nextStep } from "@/lib/dispatch/rounds";

const base = { parcels: 10, registered: 10, voided: 0, packed: 10, verified: 10, onHold: 0 };

test.each([
  [{ ...base, packed: 4 }, /Pack the parcels .*4 of 10/],
  [{ ...base }, /Hand them to Citypak/],
  [{ ...base, handedOver: 6 }, /4 packed parcels are still here/],
  [{ ...base, handedOver: 10, delivered: 3 }, /3 of 10 delivered/],
  [{ ...base, handedOver: 10, delivered: 9, problems: 1 }, /1 delivery failed/],
  [{ ...base, handedOver: 10, delivered: 9, returned: 1, codOwing: 1500 }, /Rs. 1,500 COD is still owed/],
  [{ ...base, handedOver: 10, delivered: 10, canClose: true }, /close the round/],
  [{ ...base, onHold: 2 }, /2 parcels are on hold/],
] as const)("next step %#", (counts, want) => {
  expect(nextStep("active", counts)).toMatch(want);
});
