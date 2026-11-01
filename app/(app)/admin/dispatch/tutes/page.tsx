import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SavedTutes } from "@/components/dispatch/saved-tutes";
import { requireDispatch } from "@/lib/dispatch/access";
import { createClient } from "@/lib/supabase/server";

import { getT } from "@/lib/dispatch/i18n/server";
export const metadata: Metadata = { title: "Saved tutes – Tute dispatch" };

export default async function SavedTutesPage() {
  const t = await getT();
  await requireDispatch("plan");
  const supabase = await createClient();
  const { data } = await supabase
    .from("dispatch_tutes")
    .select("id, title, short_code, version_label, qty_per_parcel")
    .is("archived_at", null)
    .order("short_code");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Saved tutes")}
        description={t("Add tutes here as soon as they are printed. When you plan a round, pick them in one click.")}
      />
      <SavedTutes tutes={data ?? []} />
    </div>
  );
}
