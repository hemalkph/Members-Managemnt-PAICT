import type { Metadata } from "next";
import { FeeWorkspace } from "@/components/fees/fee-workspace";
import { requirePage } from "@/lib/auth";
import { isMonthKey, todayISO } from "@/lib/core/month";
import { compareClassMonths, type FeeComparisonResult } from "@/lib/fees/compare";
import {
  getClassComparisonData,
  getClassTutesData,
  getFeeWorkspaceBase,
  type ClassTuteCatalogItem,
  type ScheduledMonthTute,
} from "@/lib/fees/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Fee reminders" };

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function FeeRemindersPage({ searchParams }: PageProps<"/admin/fee-reminders">) {
  const { canEdit } = await requirePage("fee_reminders");
  const sp = await searchParams;
  const supabase = await createClient();

  const { batches, classes, templates } = await getFeeWorkspaceBase(supabase);

  const requestedBatch = param(sp.batch);
  const requestedClass = param(sp.class);
  const requestedCurr = param(sp.curr);
  const requestedPrev = param(sp.prev);

  // Pick selected class & batch smartly so the page opens directly on real data.
  const matchedClass = classes.find((c) => c.id === requestedClass) ?? null;
  const selectedBatchId =
    matchedClass?.batchId ??
    (batches.some((b) => b.id === requestedBatch)
      ? requestedBatch
      : classes[0]?.batchId ?? batches.find((b) => b.isActive)?.id ?? batches[0]?.id ?? "");

  const batchClasses = classes.filter((c) => c.batchId === selectedBatchId);
  const selectedClass = matchedClass ?? batchClasses[0] ?? null;

  // Pick current & previous months chronologically (never invert prevMonth > currMonth).
  // uploadedMonths is sorted newest-first ("2026-11", "2026-10", ...).
  const uploadedMonths = selectedClass?.months.map((m) => m.month) ?? [];
  let currMonth: string | null =
    isMonthKey(requestedCurr) && uploadedMonths.includes(requestedCurr)
      ? requestedCurr
      : uploadedMonths[0] ?? null;

  let prevMonth: string | null =
    isMonthKey(requestedPrev) && uploadedMonths.includes(requestedPrev) && requestedPrev !== currMonth
      ? requestedPrev
      : uploadedMonths.find((m) => currMonth !== null && m < currMonth) ?? null;

  // If the user uploaded or selected the oldest month as ?curr= (so no earlier month exists),
  // keep the newest month as currMonth and the older month as prevMonth instead of inverting.
  if (currMonth && !prevMonth && uploadedMonths.length >= 2) {
    const newest = uploadedMonths[0];
    if (newest > currMonth) {
      prevMonth = currMonth;
      currMonth = newest;
    }
  }

  // Final chronological safeguard: if someone passed inverted ?prev=2026-11&curr=2026-10, swap them.
  if (prevMonth && currMonth && prevMonth > currMonth) {
    [prevMonth, currMonth] = [currMonth, prevMonth];
  }

  let comparison: FeeComparisonResult = {
    rows: [],
    summary: {
      prevCount: 0,
      currCount: 0,
      paidBothCount: 0,
      phoneMatchedCount: 0,
      dueTotal: 0,
      dueUnmessaged: 0,
      dueMessaged: 0,
      dueExcused: 0,
      dueDropped: 0,
      dueMissingPhone: 0,
      newCount: 0,
      retentionPct: 0,
      medianFee: null,
      distinctLabels: [],
      distinctInstitutes: [],
      distinctDistricts: [],
    },
  };

  let tuteCatalog: ClassTuteCatalogItem[] = [];
  let scheduledTutes: ScheduledMonthTute[] = [];

  const [compData, tutesData] = await Promise.all([
    selectedClass && (prevMonth || currMonth)
      ? getClassComparisonData(supabase, {
          classId: selectedClass.id,
          batchId: selectedClass.batchId,
          prevMonth,
          currMonth,
        })
      : Promise.resolve(null),
    selectedBatchId
      ? getClassTutesData(supabase, {
          batchId: selectedBatchId,
          classId: selectedClass?.id ?? null,
        })
      : Promise.resolve({ catalog: [], scheduled: [] }),
  ]);

  if (compData) {
    comparison = compareClassMonths(compData);
  }
  tuteCatalog = tutesData.catalog;
  scheduledTutes = tutesData.scheduled;

  const defaultUploadMonth = todayISO().slice(0, 7);

  return (
    <FeeWorkspace
      batches={batches}
      classes={classes}
      templates={templates}
      tuteCatalog={tuteCatalog}
      scheduledTutes={scheduledTutes}
      selectedBatchId={selectedBatchId}
      selectedClassId={selectedClass?.id ?? null}
      prevMonth={prevMonth}
      currMonth={currMonth}
      defaultUploadMonth={defaultUploadMonth}
      initialRows={comparison.rows}
      initialSummary={comparison.summary}
      canEdit={canEdit}
    />
  );
}
