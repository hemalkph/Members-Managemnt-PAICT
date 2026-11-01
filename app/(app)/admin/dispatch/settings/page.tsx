import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PeopleGrants, type DispatchPerson } from "@/components/dispatch/people-grants";
import { DispatchSettingsForm } from "@/components/dispatch/settings-form";
import { TemplateCard, type StoredTemplate } from "@/components/dispatch/template-card";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { mainAdminUnlocked } from "@/lib/auth";
import type { DispatchCapability } from "@/lib/database.types";
import { requireDispatch } from "@/lib/dispatch/access";
import { pageAccess } from "@/lib/page-access";
import { createClient } from "@/lib/supabase/server";

import { getT } from "@/lib/dispatch/i18n/server";
export const metadata: Metadata = { title: "Settings – Tute dispatch" };

export default async function DispatchSettingsPage() {
  const t = await getT();
  const { profile, caps } = await requireDispatch();
  const canPlan = caps.has("plan");
  const mainUnlocked = await mainAdminUnlocked(profile);
  if (!canPlan && !profile.is_main_admin) redirect("/admin/dispatch");

  const supabase = await createClient();
  const [{ data: settings }, people] = await Promise.all([
    supabase.from("dispatch_settings").select("*").limit(1).maybeSingle(),
    // Profiles and every grant are readable by main admins only.
    mainUnlocked
      ? Promise.all([
          supabase
            .from("profiles")
            .select("id, full_name, email, is_admin, is_main_admin, is_active, page_access")
            .eq("is_active", true)
            .order("full_name"),
          supabase.from("dispatch_grants").select("user_id, capability").is("revoked_at", null),
        ])
      : Promise.resolve(null),
  ]);

  let rows: DispatchPerson[] = [];
  if (people) {
    const [{ data: profiles }, { data: grants }] = people;
    const byUser = new Map<string, DispatchCapability[]>();
    for (const g of grants ?? []) byUser.set(g.user_id, [...(byUser.get(g.user_id) ?? []), g.capability]);
    rows = (profiles ?? [])
      .map((p) => ({
        id: p.id,
        name: p.full_name || p.email,
        kind: (p.is_main_admin ? "Main admin" : p.is_admin ? "Admin" : "Member") as DispatchPerson["kind"],
        page: pageAccess(p, "dispatch"),
        granted: byUser.get(p.id) ?? [],
      }))
      // Show everyone who can open dispatch, plus anyone holding a grant.
      .filter((p) => p.page !== "none" || p.granted.length > 0);
  }

  let template: StoredTemplate = null;
  if (settings?.citypak_template_file) {
    const { data: t } = await supabase
      .from("carrier_files")
      .select("id, file_name, summary, created_at")
      .eq("id", settings.citypak_template_file)
      .maybeSingle();
    if (t) {
      const columns = ((t.summary ?? {}) as { columns?: unknown }).columns;
      template = {
        id: t.id,
        fileName: t.file_name,
        columns: Array.isArray(columns) ? columns.map(String) : [],
        verified: settings.citypak_template_verified,
        when: formatDateTime(t.created_at),
      };
    }
  }

  const values = {
    sender_name: settings?.sender_name ?? "",
    sender_line1: settings?.sender_line1 ?? "",
    sender_line2: settings?.sender_line2 ?? "",
    sender_line3: settings?.sender_line3 ?? "",
    sender_city: settings?.sender_city ?? "",
    sender_contact_name: settings?.sender_contact_name ?? "",
    sender_phone1: settings?.sender_phone1 ?? "",
    sender_phone2: settings?.sender_phone2 ?? "",
    default_cod: Number(settings?.default_cod ?? 0),
    default_weight_g: settings?.default_weight_g ?? 1000,
    default_pieces: settings?.default_pieces ?? 1,
    require_verification: settings?.require_verification ?? true,
    allow_self_verify: settings?.allow_self_verify ?? false,
    optional_steps: (settings?.optional_steps ?? ["handover", "delivery", "money"]).filter(
      (s): s is "handover" | "delivery" | "money" => ["handover", "delivery", "money"].includes(s),
    ),
    student_retention_months: settings?.student_retention_months ?? 12,
    recipient_retention_days: settings?.recipient_retention_days ?? 180,
    courier_file_retention_days: settings?.courier_file_retention_days ?? 90,
    import_file_retention_days: settings?.import_file_retention_days ?? 30,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Dispatch settings")}
        description={t("Sender details, parcel defaults, privacy rules and who can do what.")}
      />

      <DispatchSettingsForm values={values} canEditDetails={canPlan} canEditPolicy={canPlan && mainUnlocked} />

      <TemplateCard template={template} canChange={mainUnlocked} />

      <Card>
        <CardHeader>
          <CardTitle>{t("People")}</CardTitle>
          <CardDescription>
            {t(
              "Give the Tute dispatch page first (Members → Edit → Page access), then choose what each person may do here. Admins have Plan, Courier, Pack and Verify by default; Correct and Finance are given one by one.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mainUnlocked ? (
            rows.length > 0 ? (
              <PeopleGrants people={rows} canChange={mainUnlocked} />
            ) : (
              <p className="text-muted-foreground text-sm">{t("Nobody has the Tute dispatch page yet.")}</p>
            )
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("Only main admins with two-step login can see and change dispatch permissions.")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
