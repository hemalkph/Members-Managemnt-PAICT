import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, FilePlus2Icon, InboxIcon, LandmarkIcon } from "lucide-react";
import BlurText from "@/components/reactbits/blur-text";
import { EmptyState } from "@/components/empty-state";
import { MonthlySummary } from "@/components/member/monthly-summary";
import { RolesList } from "@/components/member/roles-list";
import { SubmissionCard } from "@/components/member/submission-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getSubmissionsForMonth, summarise } from "@/lib/member-queries";
import { currentMonthKey, monthLabel } from "@/lib/month";
import { getMemberRoles } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const profile = await requireUser();
  const supabase = await createClient();
  const month = currentMonthKey();

  const [submissions, roles, { data: bank }] = await Promise.all([
    getSubmissionsForMonth(supabase, profile.id, month),
    getMemberRoles(supabase, profile.id),
    supabase.from("bank_details").select("user_id").eq("user_id", profile.id).maybeSingle(),
  ]);
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

      <MonthlySummary month={month} {...summary} />

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

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
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
                <SubmissionCard key={s.id} submission={s} />
              ))}
            </div>
          )}
        </section>
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
  );
}
