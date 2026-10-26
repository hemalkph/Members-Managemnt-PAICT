import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

export type RoleWithSection = {
  id: string;
  name: string;
  sectionId: string;
  sectionName: string;
  sectionOrder: number;
  roleOrder: number;
};

export type SectionWithRoles = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  roles: { id: string; name: string; description: string | null; sort_order: number }[];
};

function sortRoles(a: RoleWithSection, b: RoleWithSection) {
  return (
    a.sectionOrder - b.sectionOrder ||
    a.sectionName.localeCompare(b.sectionName) ||
    a.roleOrder - b.roleOrder ||
    a.name.localeCompare(b.name)
  );
}

/** All sections with their roles, in display order. */
export async function getStructure(supabase: Client): Promise<SectionWithRoles[]> {
  const { data } = await supabase
    .from("sections")
    .select("id, name, description, sort_order, roles(id, name, description, sort_order)")
    .order("sort_order")
    .order("name");

  return (data ?? []).map((section) => ({
    ...section,
    roles: [...section.roles].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
  }));
}

/** Flat list of every role with its section. */
export function flattenRoles(structure: SectionWithRoles[]): RoleWithSection[] {
  return structure.flatMap((section) =>
    section.roles.map((role) => ({
      id: role.id,
      name: role.name,
      sectionId: section.id,
      sectionName: section.name,
      sectionOrder: section.sort_order,
      roleOrder: role.sort_order,
    })),
  );
}

/** Roles assigned to one member (RLS: own roles, or any for admins). */
export async function getMemberRoles(supabase: Client, userId: string): Promise<RoleWithSection[]> {
  const { data } = await supabase
    .from("member_roles")
    .select("role_id, roles(id, name, sort_order, sections(id, name, sort_order))")
    .eq("user_id", userId);

  return (data ?? [])
    .flatMap((row) => (row.roles && row.roles.sections ? [{ role: row.roles, section: row.roles.sections }] : []))
    .map(({ role, section }) => ({
      id: role.id,
      name: role.name,
      sectionId: section.id,
      sectionName: section.name,
      sectionOrder: section.sort_order,
      roleOrder: role.sort_order,
    }))
    .sort(sortRoles);
}

export type RoleRate = { id: string; name: string; unit: string; price: number };

/** Rate categories for the given roles (members only see their own roles' rates). */
export async function getRatesForRoles(supabase: Client, roleIds: string[]): Promise<Map<string, RoleRate[]>> {
  const map = new Map<string, RoleRate[]>();
  if (roleIds.length === 0) return map;
  const { data } = await supabase
    .from("rate_items")
    .select("id, role_id, name, unit, price, sort_order")
    .in("role_id", roleIds)
    .order("sort_order");
  for (const r of data ?? []) {
    map.set(r.role_id, [...(map.get(r.role_id) ?? []), { id: r.id, name: r.name, unit: r.unit, price: Number(r.price) }]);
  }
  return map;
}
