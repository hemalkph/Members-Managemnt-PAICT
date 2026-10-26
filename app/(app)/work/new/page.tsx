import type { Metadata } from "next";
import { UserRoundXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SubmissionForm } from "@/components/member/submission-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { parseMonthParam, recentMonths, todayISO } from "@/lib/month";
import { getMemberRoles } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Submit work" };

export default async function NewWorkPage({ searchParams }: PageProps<"/work/new">) {
  const profile = await requireUser();
  const month = parseMonthParam((await searchParams).month);
  const supabase = await createClient();
  const roles = await getMemberRoles(supabase, profile.id);
  const months = recentMonths(12, true);
  if (!months.includes(month)) months.push(month);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Submit work" description="Log a task you finished. An admin will review it." />
      {roles.length === 0 ? (
        <EmptyState
          icon={UserRoundXIcon}
          title="You don't have a role yet"
          description="An admin needs to assign at least one role to you before you can log work."
        />
      ) : (
        <Card>
          <CardContent>
            <SubmissionForm
              userId={profile.id}
              roles={roles}
              months={months}
              today={todayISO()}
              defaultValues={{
                work_month: month,
                role_id: roles.length === 1 ? roles[0].id : "",
                title: "",
                description: "",
                quantity: 1,
                date_done: todayISO(),
                links: [],
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
