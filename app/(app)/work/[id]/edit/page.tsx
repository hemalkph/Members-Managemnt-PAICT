import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LockIcon, MessageSquareWarningIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SubmissionForm } from "@/components/member/submission-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireCompleteProfile } from "@/lib/auth";
import { dateToMonthKey, todayISO } from "@/lib/core/month";
import { SHOW_MEMBERS_THEIR_EARNINGS } from "@/lib/core/config";
import { activeOptions, getClassOptions } from "@/lib/organisation/classes";
import { getMemberRoles, getRatesForRoles } from "@/lib/organisation/structure";
import { createClient } from "@/lib/supabase/server";
import { getMyPayMonth } from "@/lib/members/queries";
import { uuid } from "@/lib/core/validation";

export const metadata: Metadata = { title: "Edit submission" };

export default async function EditWorkPage({ params }: PageProps<"/work/[id]/edit">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const profile = await requireCompleteProfile();
  const supabase = await createClient();
  const [{ data: submission }, roles] = await Promise.all([
    supabase
      .from("submissions")
      .select("id, role_id, rate_item_id, work_month, title, description, quantity, date_done, links, status, admin_comment, exam_id, centre_id, task_id, task:tasks(title), submission_attachments(id, file_name, size_bytes), submission_videos(drive_file_id, name)")
      .eq("id", id)
      .eq("user_id", profile.id)
      .maybeSingle(),
    getMemberRoles(supabase, profile.id),
  ]);

  if (!submission) notFound();
  const month = dateToMonthKey(submission.work_month);

  const rejected = submission.status === "rejected";
  // Rejected work in a closed month can't change any more: log it again instead.
  const { data: closed } = rejected
    ? await supabase.from("pay_months").select("month").eq("month", submission.work_month).maybeSingle()
    : { data: null };

  if (submission.status === "approved" || closed) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="Edit submission" />
        <EmptyState
          icon={LockIcon}
          title={closed ? "This month is closed" : "This submission was already approved"}
          description={
            closed
              ? "Its payments are done, so this work can't be sent again. Log it again as new work."
              : "Approved work can't be edited."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline">
                <Link href={`/work?month=${month}`}>Back to my work</Link>
              </Button>
              {closed && (
                <Button asChild>
                  <Link href={`/work/new?from=${submission.id}`}>Log it again</Link>
                </Button>
              )}
            </div>
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
  const workMonth = await getMyPayMonth(supabase, profile.id);
  const rates = await getRatesForRoles(
    supabase,
    roles.map((r) => r.id),
  );
  const roleOptions = roles.map((r) => ({ ...r, rates: rates.get(r.id) ?? [] }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={rejected ? "Fix and send again" : "Edit submission"}
        description={
          rejected
            ? "Fix what the admin asked for, then save. Your work goes back for review."
            : "You can edit work until an admin reviews it."
        }
      />
      {rejected && (
        <div className="border-destructive/40 bg-destructive/5 flex gap-3 rounded-xl border p-4 text-sm">
          <MessageSquareWarningIcon className="text-destructive mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Why it was not approved</p>
            <p className="text-muted-foreground whitespace-pre-line break-words">
              {submission.admin_comment || "No reason was given. Ask an admin if you're not sure what to fix."}
            </p>
          </div>
        </div>
      )}
      <Card>
        <CardContent>
          <SubmissionForm
            userId={profile.id}
            submissionId={submission.id}
            roles={roleOptions}
            showMoney={SHOW_MEMBERS_THEIR_EARNINGS}
            today={todayISO()}
            existingAttachments={submission.submission_attachments}
            existingVideos={submission.submission_videos.map((v) => ({ id: v.drive_file_id, name: v.name }))}
            exams={tags.exams.map((e) => ({ id: e.id, label: e.label }))}
            centres={tags.centres.map((c) => ({ id: c.id, name: c.name }))}
            taskTitle={submission.task?.title ?? null}
            resend={rejected}
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
