import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MultiSelectOption } from "@/components/ui/multi-select";
import type { Database } from "@/lib/database.types";
import type { SectionWithRoles } from "@/lib/queries";

export function roleOptionsFrom(structure: SectionWithRoles[]): MultiSelectOption[] {
  return structure.flatMap((s) => s.roles.map((r) => ({ value: r.id, label: r.name, group: s.name })));
}

/** user id -> role ids */
export async function getAllMemberRoles(supabase: SupabaseClient<Database>) {
  const { data } = await supabase.from("member_roles").select("user_id, role_id");
  const map = new Map<string, string[]>();
  for (const row of data ?? []) map.set(row.user_id, [...(map.get(row.user_id) ?? []), row.role_id]);
  return map;
}
