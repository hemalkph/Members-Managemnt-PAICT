import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, FilePlus2Icon, InboxIcon, LandmarkIcon } from "lucide-react";
import BlurText from "@/components/reactbits/blur-text";
import { DeadlineCard } from "@/components/deadline/deadline-card";
import { EmptyState } from "@/components/empty-state";
import { MonthlySummary } from "@/components/member/monthly-summary";
import { RolesList } from "@/components/member/roles-list";
import { NoticeBoard } from "@/components/notice-board";
import { SubmissionCard } from "@/components/member/submission-card";
import { MyTasksCard } from "@/components/tasks/my-tasks-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompleteProfile } from "@/lib/auth";
import { SHOW_MEMBERS_THEIR_EARNINGS } from "@/lib/config";
import { getMySalary, getSubmissionsForMonth, summarise } from "@/lib/member-queries";
import { getDeadlines, sendDueRemindersLater } from "@/lib/deadlines";
import { currentMonthKey, monthLabel, shiftMonth } from "@/lib/month";
import { getClosedMonthKeys } from "@/lib/payments";
import { getTasks } from "@/lib/task-queries";
import { getCurrentNotices } from "@/lib/notices";
import { getMemberRoles } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

/** % of the time between start and end that has passed. */
function progressTo(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const now = Date.now();
  if (e <= s) return 100;
  return Math.min(100, Math.max(0, Math.round(((now - s) / (e - s)) * 100)));
}

export default async function DashboardPage() {
  const profile = await requireCompleteProfile();
  const supabase = await createClient();
  const month = currentMonthKey();

  const previous = shiftMonth(month, -1);
  // Reminders: also sent by a daily job; this catches up after the page is sent.
  await sendDueRemindersLater(supabase);
  const [submissions, roles, { data: bank }, notices, salary, deadlines, closedMonths, myTasks] = await Promise.all([
    getSubmissionsForMonth(supabase, profile.id, month),
    getMemberRoles(supabase, profile.id),
    supabase.from("bank_details").select("user_id").eq("user_id", profile.id).maybeSingle(),
    getCurrentNotices(supabase, 5),
    SHOW_MEMBERS_THEIR_EARNINGS ? getMySalary(supabase, profile.id) : Promise.resolve(0),
    getDeadlines(supabase, [previous, month]),
    getClosedMonthKeys(supabase),
    getTasks(supabase, { assigneeId: profile.id, statuses: ["open"], limit: 20 }),
  ]);
  // The next deadline: last month's if it is still open, otherwise this month's.
  const prevDeadline = deadlines.get(previous);
  const nextDeadline =
    prevDeadline?.deadline && !prevDeadline.passed && !closedMonths.includes(previous)
      ? prevDeadline
      : deadlines.get(month);
  const deadlineProgress = nextDeadline?.deadline
    ? progressTo(`${nextDeadline.month}-01T00:00:00+05:30`, nextDeadline.deadline)
    : 0;
  const summary = summarise(submissions);
  const firstName = (profile.full_name || "there").split(" ")[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <BlurText as="h1" text={`Hi, ${firstName}!`} className="text-2xl font-semibold tracking-tight sm:text-3xl" />
          <p className="text-muted-foreground text-sm">Here&apos;s your work for {monthLabel(month)}.</p>
        </div>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href="/work/new">
            <FilePlus2Icon /> Submit work
          </Link>
        </Button>
      </div>

      {roles.length > 0 && nextDeadline && <DeadlineCard deadline={nextDeadline} progress={deadlineProgress} />}

      <MonthlySummary month={month} {...summary} salary={salary} showMoney={SHOW_MEMBERS_THEIR_EARNINGS} />

      {!bank && (
        <Link
          href="/bank"
          className="border-warning/50 bg-warning/10 hover:bg-warning/15 flex items-center gap-3 rounded-xl border p-4 text-sm transition-colors"
        >
          <LandmarkIcon className="size-5 shrink-0 text-amber-600 dark:text-warning" />
          <span className="flex-1">Add your bank details so the team can pay you.</span>
          <ArrowRightIcon className="size-4" />
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">This month</h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/work">
                View all <ArrowRightIcon />
              </Link>
            </Button>
          </div>
          {submissions.length === 0 ? (
            <EmptyState
              icon={InboxIcon}
              title="Nothing logged yet this month"
              description="Submit your first piece of work for this month."
            />
          ) : (
            <div className="grid gap-3">
              {submissions.slice(0, 4).map((s) => (
                <SubmissionCard key={s.id} submission={s} showMoney={SHOW_MEMBERS_THEIR_EARNINGS} />
              ))}
            </div>
          )}
        </section>
        <div className="grid h-fit gap-6">
          <MyTasksCard tasks={myTasks} />
          <NoticeBoard notices={notices} />
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>My roles</CardTitle>
              <CardDescription>You can log work for these roles.</CardDescription>
            </CardHeader>
            <CardContent>
              <RolesList roles={roles} emptyText="No roles yet. Ask an admin to assign your roles." />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
