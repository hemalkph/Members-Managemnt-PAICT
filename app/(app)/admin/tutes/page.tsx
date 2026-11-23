import type { Metadata } from "next";
import { BookCopyIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TuteWorkspace, type TuteTab } from "@/components/tutes/tute-workspace";
import { BatchSelect } from "@/components/tutes/batch-select";
import { MonthSelect } from "@/components/month-select";
import { requirePage } from "@/lib/auth";
import { isMonthKey, todayISO } from "@/lib/core/month";
import { getTuteBatches, getTuteWorkspace } from "@/lib/tutes/queries";
import { sendDueRemindersLater } from "@/lib/work/deadlines";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tute stock" };

const TABS: TuteTab[] = ["stock", "jobs", "history"];

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function TutesPage({ searchParams }: PageProps<"/admin/tutes">) {
  const { canEdit } = await requirePage("tutes");
  const sp = await searchParams;
  const supabase = await createClient();
  // Backup for the 9:00 job: catch up on stock alerts after the page is sent.
  await sendDueRemindersLater(supabase, "send_tute_stock_alerts");

  const batches = await getTuteBatches(supabase);
  const requestedBatch = param(sp.batch);
  const batchId = batches.some((b) => b.id === requestedBatch)
    ? requestedBatch
    : (batches.find((b) => b.isActive)?.id ?? batches[0]?.id ?? "");
  const month = isMonthKey(param(sp.month)) ? param(sp.month) : todayISO().slice(0, 7);
  const tab = TABS.find((t) => t === param(sp.tab)) ?? "stock";

  const header = (
    <PageHeader
      title="Tute stock"
      description="How many copies we have, how many each class needs, and what is being printed."
      actions={
        batches.length > 0 && (
          <>
            <BatchSelect batches={batches} value={batchId} />
            <MonthSelect value={month} calendar />
          </>
        )
      }
    />
  );

  if (!batchId) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState icon={BookCopyIcon} title="No batches yet" description="Add a batch in Batches & exams first." />
      </div>
    );
  }

  const data = await getTuteWorkspace(supabase, batchId, month);

  return (
    <div className="space-y-4">
      {header}
      <TuteWorkspace {...data} month={month} tab={tab} canEdit={canEdit} />
    </div>
  );
}
