import type { Metadata } from "next";
import { ClassOpsWorkspace } from "@/components/class-ops/class-ops-workspace";
import { MonthSelect } from "@/components/month-select";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { requirePage } from "@/lib/auth";
import { getClassOps } from "@/lib/class-ops/queries";
import { isMonthKey, todayISO } from "@/lib/core/month";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Classes" };

export default async function ClassOpsPage({ searchParams }: PageProps<"/admin/class-ops">) {
  const { canEdit } = await requirePage("class_ops");
  const sp = await searchParams;
  const raw = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  const month = raw && isMonthKey(raw) ? raw : todayISO().slice(0, 7);
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) === "plan" ? "plan" : "classes";
  const data = await getClassOps(await createClient(), month);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Classes"
        description="Every batch's classes, the tutes each one gets month by month, and how many have paid so far."
        actions={<MonthSelect value={month} calendar />}
      />
      {!canEdit && <ReadOnlyNotice />}
      <ClassOpsWorkspace {...data} month={month} tab={tab} canEdit={canEdit} />
    </div>
  );
}
