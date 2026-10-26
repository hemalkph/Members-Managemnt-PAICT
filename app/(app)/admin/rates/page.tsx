import type { Metadata } from "next";
import { RatesManager, type RatesRole } from "@/components/admin/rates-manager";
import { PageHeader } from "@/components/page-header";
import { requireMainAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Rates & budget" };

export default async function RatesPage() {
  await requireMainAdmin();
  const supabase = await createClient();
  const [{ data: sections }, { data: items }] = await Promise.all([
    supabase
      .from("sections")
      .select("name, sort_order, roles(id, name, is_salaried, sort_order)")
      .order("sort_order")
      .order("name"),
    supabase.from("rate_items").select("id, role_id, name, unit, price, sort_order").order("sort_order"),
  ]);

  const roles: RatesRole[] = (sections ?? []).flatMap((section) =>
    [...section.roles]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((role) => ({
        id: role.id,
        name: role.name,
        sectionName: section.name,
        is_salaried: role.is_salaried,
        items: (items ?? [])
          .filter((i) => i.role_id === role.id)
          .map((i) => ({ id: i.id, name: i.name, unit: i.unit, price: Number(i.price) })),
      })),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rates & budget"
        description="Set how much each role is paid per page, design, paper or marking scheme, and preview the cost."
      />
      <RatesManager roles={roles} />
    </div>
  );
}
