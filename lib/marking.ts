import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getMemberRoles, getRatesForRoles } from "@/lib/queries";
import type { PaperPart } from "@/lib/papers";

type Client = SupabaseClient<Database>;

export type MarkingRate = { roleId: string; rateItemId: string; name: string; price: number };
export type MarkingRates = { mcq: MarkingRate | null; essay: MarkingRate | null };

/** The member's "MCQ paper marking" and "Essay paper marking" rates (from any of their roles). */
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
  return { mcq: find(/mcq/i), essay: find(/essay/i) };
}

/** Which marked-paper counts a paper takes: a full paper has both MCQ and Essay. */
export function markingParts(part: PaperPart): ("mcq" | "essay")[] {
  return part === "mcq" ? ["mcq"] : part === "essay" ? ["essay"] : ["mcq", "essay"];
}
