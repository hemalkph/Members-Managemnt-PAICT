import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LockIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SubmissionForm } from "@/components/member/submission-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireCompleteProfile } from "@/lib/auth";
import { dateToMonthKey, recentMonths, todayISO } from "@/lib/month";
import { SHOW_MEMBERS_THEIR_EARNINGS } from "@/lib/config";
import { getClosedMonthKeys } from "@/lib/payments";
import { getMemberRoles, getRatesForRoles } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Edit submission" };

export default async function EditWorkPage({ params }: PageProps<"/work/[id]/edit">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const profile = await requireCompleteProfile();
  const supabase = await createClient();
  const [{ data: submission }, roles] = await Promise.all([
    supabase
      .from("submissions")
      .select("id, role_id, rate_item_id, work_month, title, description, quantity, date_done, links, status, submission_attachments(id, file_name, size_bytes)")
      .eq("id", id)
      .eq("user_id", profile.id)
      .maybeSingle(),
    getMemberRoles(supabase, profile.id),
  ]);

  if (!submission) notFound();
  const month = dateToMonthKey(submission.work_month);

  if (submission.status !== "pending") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="Edit submission" />
        <EmptyState
          icon={LockIcon}
          title="This submission was already reviewed"
          description="Only pending submissions can be edited."
          action={
            <Button asChild variant="outline">
              <Link href={`/work?month=${month}`}>Back to my work</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const closed = new Set(await getClosedMonthKeys(supabase));
  const months = recentMonths(12, true).filter((m) => !closed.has(m));
  if (!months.includes(month)) months.push(month);
  const rates = await getRatesForRoles(
    supabase,
    roles.map((r) => r.id),
  );
  const roleOptions = roles.map((r) => ({ ...r, rates: rates.get(r.id) ?? [] }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Edit submission" description="You can edit work until an admin reviews it." />
      <Card>
        <CardContent>
          <SubmissionForm
            userId={profile.id}
            submissionId={submission.id}
            roles={roleOptions}
            showMoney={SHOW_MEMBERS_THEIR_EARNINGS}
            months={months}
            today={todayISO()}
            existingAttachments={submission.submission_attachments}
            defaultValues={{
              work_month: month,
              role_id: roles.some((r) => r.id === submission.role_id) ? submission.role_id : "",
              rate_item_id: submission.rate_item_id ?? "",
              title: submission.title,
              description: submission.description ?? "",
              quantity: submission.quantity,
              date_done: submission.date_done,
              links: submission.links.map((url) => ({ url })),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
