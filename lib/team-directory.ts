import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type TeamMember = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  isActive: boolean;
};

/**
 * The team's names for people with the Papers or Tasks page (contact numbers
 * only for people who can edit them). Never NIC, birthday or bank details.
 */
export async function getTeamDirectory(supabase: SupabaseClient<Database>): Promise<TeamMember[]> {
  const { data } = await supabase.rpc("team_directory");
  return (data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    phone: m.phone,
    whatsapp: m.whatsapp,
    isActive: m.is_active,
  }));
}

export function teamNames(team: TeamMember[]): Map<string, string> {
  return new Map(team.map((m) => [m.id, m.name]));
}
