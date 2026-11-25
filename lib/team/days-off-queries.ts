import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDaysOff, type DayOff } from "@/lib/team/availability";
import type { Database } from "@/lib/supabase/database.types";

/** Days off overlapping [from, to] that this person may see; [] if they can't be loaded (e.g. before migration 079). */
export async function getTeamDaysOff(supabase: SupabaseClient<Database>, from: string, to: string): Promise<DayOff[]> {
  const { data, error } = await supabase.rpc("team_days_off", { p_from: from, p_to: to });
  if (error) return [];
  return mapDaysOff(data ?? []);
}
