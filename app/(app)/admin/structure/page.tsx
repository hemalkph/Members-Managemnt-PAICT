import type { Metadata } from "next";
import { StructureManager } from "@/components/admin/structure-manager";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { requirePage } from "@/lib/auth";
import { getStructure } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sections & roles" };

export default async function StructurePage() {
  const { canEdit } = await requirePage("structure");
  const supabase = await createClient();
  const [structure, { data: memberRoles }, { data: submissions }] = await Promise.all([
    getStructure(supabase),
    supabase.from("member_roles").select("role_id"),
    supabase.from("submissions").select("role_id"),
  ]);

  const count = (rows: { role_id: string }[] | null) => {
    const map = new Map<string, number>();
    for (const r of rows ?? []) map.set(r.role_id, (map.get(r.role_id) ?? 0) + 1);
    return map;
  };
  const members = count(memberRoles);
  const subs = count(submissions);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sections & roles"
        description="Sections group the team's roles. Members can hold several roles across sections."
      />
      {!canEdit && <ReadOnlyNotice />}
      <StructureManager
        readOnly={!canEdit}
        sections={structure.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          roles: s.roles.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            members: members.get(r.id) ?? 0,
            submissions: subs.get(r.id) ?? 0,
          })),
        }))}
      />
    </div>
  );
}
