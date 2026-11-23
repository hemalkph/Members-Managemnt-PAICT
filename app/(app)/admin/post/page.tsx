import type { Metadata } from "next";
import { TruckIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MonthSelect } from "@/components/month-select";
import { PageHeader } from "@/components/page-header";
import { PostWorkspace } from "@/components/post/post-workspace";
import { BatchSelect } from "@/components/tutes/batch-select";
import { requirePage } from "@/lib/auth";
import { isMonthKey, todayISO } from "@/lib/core/month";
import { getPostMonth } from "@/lib/post/queries";
import { getTuteBatches } from "@/lib/tutes/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Speed Post" };

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function PostPage({ searchParams }: PageProps<"/admin/post">) {
  const { canEdit } = await requirePage("post");
  const sp = await searchParams;
  const supabase = await createClient();

  const batches = await getTuteBatches(supabase);
  const requestedBatch = param(sp.batch);
  const batchId = batches.some((b) => b.id === requestedBatch)
    ? requestedBatch
    : (batches.find((b) => b.isActive)?.id ?? batches[0]?.id ?? "");
  const month = isMonthKey(param(sp.month)) ? param(sp.month) : todayISO().slice(0, 7);

  const header = (
    <PageHeader
      title="Speed Post"
      description="Post each month's tutes to Online students: build a round, pack, scan tracking numbers, hand over."
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
        <EmptyState icon={TruckIcon} title="No batches yet" description="Add a batch in Batches & exams first." />
      </div>
    );
  }

  const data = await getPostMonth(supabase, batchId, month);

  return (
    <div className="space-y-4">
      {header}
      <PostWorkspace {...data} batchId={batchId} month={month} canEdit={canEdit} tab={param(sp.tab) === "addresses" ? "addresses" : "rounds"} />
    </div>
  );
}
