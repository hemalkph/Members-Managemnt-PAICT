import type { DispatchCapability } from "@/lib/supabase/database.types";

/** What each dispatch permission allows (shown on the People tab). */
export const CAPABILITIES: { key: DispatchCapability; title: string; description: string; adminDefault: boolean }[] = [
  { key: "plan", title: "Plan", description: "Plan rounds, students and imports", adminDefault: true },
  { key: "courier", title: "Courier", description: "Citypak files, tracking numbers and delivery updates", adminDefault: true },
  { key: "pack", title: "Pack", description: "Pack parcels at the packing station", adminDefault: true },
  { key: "verify", title: "Verify", description: "Check packed parcels and hand them to Citypak", adminDefault: true },
  { key: "correct", title: "Correct", description: "Fix mistakes: cancel, unpack or reopen parcels (with a reason)", adminDefault: false },
  { key: "finance", title: "Finance", description: "Record the COD money Citypak pays", adminDefault: false },
];

export const CAPABILITY_KEYS = CAPABILITIES.map((c) => c.key);
