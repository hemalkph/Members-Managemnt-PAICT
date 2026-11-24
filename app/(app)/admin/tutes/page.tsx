import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { TuteWorkspace, type TuteTab } from "@/components/tutes/tute-workspace";
import { MonthSelect } from "@/components/month-select";
import { requirePage } from "@/lib/auth";
import { pageAccess } from "@/lib/auth/page-access";
import { isMonthKey, todayISO } from "@/lib/core/month";
import { uuid } from "@/lib/core/validation";
import { getTuteWorkspace } from "@/lib/tutes/queries";
import { sendDueRemindersLater } from "@/lib/work/deadlines";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tute stock" };

const TABS: TuteTab[] = ["stock", "plan", "jobs", "history"];

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function TutesPage({ searchParams }: PageProps<"/admin/tutes">) {
  const { profile, canEdit } = await requirePage("tutes");
  const canSchedule = pageAccess(profile, "fee_reminders") === "edit";
  const sp = await searchParams;
  const supabase = await createClient();
  // Backup for the 9:00 job: catch up on stock alerts after the page is sent.
  await sendDueRemindersLater(supabase, "send_tute_stock_alerts");

  const month = isMonthKey(param(sp.month)) ? param(sp.month) : todayISO().slice(0, 7);
  const tab = TABS.find((t) => t === param(sp.tab)) ?? "stock";
  const orderParam = param(sp.order);
  const orderTuteId = uuid.safeParse(orderParam).success ? orderParam : null;

  const data = await getTuteWorkspace(supabase, month);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tute stock"
        description="One shelf for every batch: keep the copies and see what to print."
        actions={<MonthSelect value={month} calendar />}
      />
      <TuteWorkspace
        {...data}
        month={month}
        tab={tab}
        canEdit={canEdit}
        canSchedule={canSchedule}
        orderTuteId={orderTuteId}
      />
    </div>
  );
}
