import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2Icon, InboxIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MonthlySummary } from "@/components/member/monthly-summary";
import { SubmissionCard } from "@/components/member/submission-card";
import { MonthSelect } from "@/components/month-select";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireCompleteProfile } from "@/lib/auth";
import { SHOW_MEMBERS_THEIR_EARNINGS } from "@/lib/config";
import { getMySalary, getSubmissionsForMonth, summarise } from "@/lib/member-queries";
import { monthLabel, parseMonthParam } from "@/lib/month";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My work" };

export default async function MyWorkPage({ searchParams }: PageProps<"/work">) {
  const profile = await requireCompleteProfile();
  const month = parseMonthParam((await searchParams).month);
  const supabase = await createClient();
  const [submissions, salary] = await Promise.all([
    getSubmissionsForMonth(supabase, profile.id, month),
    SHOW_MEMBERS_THEIR_EARNINGS ? getMySalary(supabase, profile.id) : Promise.resolve(0),
  ]);
  const summary = summarise(submissions);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My work"
        description="Your submissions and their review status."
        actions={
          <>
            <MonthSelect value={month} />
            <Button asChild>
              <Link href={`/work/new?month=${month}`}>
                <FilePlus2Icon /> Submit work
              </Link>
            </Button>
          </>
        }
      />
      <MonthlySummary month={month} {...summary} salary={salary} showMoney={SHOW_MEMBERS_THEIR_EARNINGS} />
      {submissions.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title={`No work logged for ${monthLabel(month)}`}
          description="When you finish a task, add it here so an admin can review it."
          action={
            <Button asChild variant="outline">
              <Link href={`/work/new?month=${month}`}>
                <FilePlus2Icon /> Submit work
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {submissions.map((s) => (
            <SubmissionCard key={s.id} submission={s} showMoney={SHOW_MEMBERS_THEIR_EARNINGS} />
          ))}
        </div>
      )}
    </div>
  );
}
