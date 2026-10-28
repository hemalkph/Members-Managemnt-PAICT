import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getMemberRoles, getRatesForRoles } from "@/lib/queries";
import type { PaperPart } from "@/lib/papers";

type Client = SupabaseClient<Database>;

export type MarkingRate = { roleId: string; rateItemId: string; name: string; price: number };
export type MarkingPart = "mcq" | "essay" | "full";
export type MarkingRates = Record<MarkingPart, MarkingRate | null>;
export const MARKING_LABEL: Record<MarkingPart, string> = { mcq: "MCQ", essay: "Essay", full: "Full paper" };

/** The member's "MCQ / Essay / Full paper marking" rates (from any of their roles). */
export async function getMarkingRates(supabase: Client, userId: string): Promise<MarkingRates> {
  const roles = await getMemberRoles(supabase, userId);
  const rates = await getRatesForRoles(
    supabase,
    roles.map((r) => r.id),
  );
  const find = (re: RegExp): MarkingRate | null => {
    for (const role of roles) {
      const r = (rates.get(role.id) ?? []).find((x) => re.test(x.name) && /mark/i.test(x.name));
      if (r) return { roleId: role.id, rateItemId: r.id, name: r.name, price: r.price };
    }
    return null;
  };
  return { mcq: find(/mcq/i), essay: find(/essay/i), full: find(/full/i) };
}

/**
 * What a paper is for marking. A paper made as one of a split pair can still be
 * saved as "full", so its title decides: "… - MCQ" is MCQ, "… SE & Essay" is Essay.
 */
export function markingKind(part: PaperPart, title: string): "mcq" | "essay" | "full" {
  if (part !== "full") return part;
  const mcq = /\bmcq\b/i.test(title);
  const essay = /essay|\bse\b/i.test(title);
  if (mcq && !essay) return "mcq";
  if (essay && !mcq) return "essay";
  return "full";
}

/** Which counts a paper takes: a full paper is marked whole ("Full paper") or by part (MCQ / Essay). */
export function markingParts(part: PaperPart, title: string): MarkingPart[] {
  const kind = markingKind(part, title);
  return kind === "full" ? ["full", "mcq", "essay"] : [kind];
}
