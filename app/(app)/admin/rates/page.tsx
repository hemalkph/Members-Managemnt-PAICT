import type { Metadata } from "next";
import { RatesManager, type RatesRole } from "@/components/admin/rates-manager";
import { PageHeader } from "@/components/page-header";
import { requireMainAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Rates & budget" };

export default async function RatesPage() {
  await requireMainAdmin();
  const supabase = await createClient();
  const [{ data: sections }, { data: items }, { data: holders }, { data: salaries }] = await Promise.all([
    supabase
      .from("sections")
      .select("name, sort_order, roles(id, name, is_salaried, sort_order)")
      .order("sort_order")
      .order("name"),
    supabase.from("rate_items").select("id, role_id, name, unit, price, sort_order").order("sort_order"),
    supabase.from("member_roles").select("role_id, profiles(id, full_name, email, is_active)"),
    supabase.from("member_salaries").select("user_id, role_id, monthly_amount"),
  ]);

  const salaryOf = new Map((salaries ?? []).map((s) => [`${s.user_id}:${s.role_id}`, Number(s.monthly_amount)]));

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
        members: (holders ?? [])
          .flatMap((h) =>
            h.role_id === role.id && h.profiles?.is_active
              ? [
                  {
                    id: h.profiles.id,
                    name: h.profiles.full_name || h.profiles.email,
                    salary: salaryOf.get(`${h.profiles.id}:${role.id}`) ?? 0,
                  },
                ]
              : [],
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rates & budget"
        description="Set how much each role is paid per page, design, paper or marking scheme, and fixed monthly salaries. Preview the cost live."
      />
      <RatesManager roles={roles} />
    </div>
  );
}
