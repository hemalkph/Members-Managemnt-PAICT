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
import { currentMonthKey, dateToMonthKey, todayISO } from "@/lib/month";
import { SHOW_MEMBERS_THEIR_EARNINGS } from "@/lib/config";
import { activeOptions, getClassOptions } from "@/lib/classes";
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
      .select("id, role_id, rate_item_id, work_month, title, description, quantity, date_done, links, status, exam_id, centre_id, task_id, task:tasks(title), submission_attachments(id, file_name, size_bytes)")
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

  const tags = activeOptions(await getClassOptions(supabase), {
    examId: submission.exam_id,
    centreId: submission.centre_id,
  });
  // Saving pending work moves it to the month open now (the database decides).
  const workMonth = currentMonthKey();
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
            today={todayISO()}
            existingAttachments={submission.submission_attachments}
            exams={tags.exams.map((e) => ({ id: e.id, label: e.label }))}
            centres={tags.centres.map((c) => ({ id: c.id, name: c.name }))}
            taskTitle={submission.task?.title ?? null}
            defaultValues={{
              work_month: workMonth,
              role_id: roles.some((r) => r.id === submission.role_id) ? submission.role_id : "",
              rate_item_id: submission.rate_item_id ?? "",
              title: submission.title,
              description: submission.description ?? "",
              quantity: submission.quantity,
              date_done: submission.date_done,
              links: submission.links.map((url) => ({ url })),
              exam_id: submission.exam_id ?? "",
              centre_id: submission.centre_id ?? "",
              task_id: submission.task_id ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
