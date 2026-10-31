import type { DispatchCapability } from "@/lib/database.types";

/** What each dispatch permission allows (shown on the People tab). */
export const CAPABILITIES: { key: DispatchCapability; title: string; description: string; adminDefault: boolean }[] = [
  { key: "plan", title: "Plan", description: "Students, imports, rounds, assignments", adminDefault: true },
  { key: "courier", title: "Courier", description: "Citypak files, tracking numbers, delivery", adminDefault: true },
  { key: "pack", title: "Pack", description: "Scan and confirm packed parcels", adminDefault: true },
  { key: "verify", title: "Verify", description: "Second check and handovers", adminDefault: true },
  { key: "correct", title: "Correct", description: "Void, unpack, reopen (with a reason)", adminDefault: false },
  { key: "finance", title: "Finance", description: "COD money and settlements", adminDefault: false },
];

export const CAPABILITY_KEYS = CAPABILITIES.map((c) => c.key);
