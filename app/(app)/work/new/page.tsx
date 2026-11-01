import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardPenIcon, UserRoundXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PaperDraftsCard } from "@/components/member/paper-drafts-card";
import { SubmissionForm } from "@/components/member/submission-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireCompleteProfile } from "@/lib/auth";
import { SHOW_MEMBERS_THEIR_EARNINGS } from "@/lib/config";
import { currentMonthKey, todayISO } from "@/lib/month";
import { activeOptions, getClassOptions } from "@/lib/classes";
import { getMarkingRates } from "@/lib/marking";
import { getPaperDrafts, toDraftItems } from "@/lib/paper-drafts";
import { getMemberRoles, getRatesForRoles } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Submit work" };

export default async function NewWorkPage({ searchParams }: PageProps<"/work/new">) {
  const profile = await requireCompleteProfile();
  const sp = await searchParams;
  const fromId = typeof sp.from === "string" && uuid.safeParse(sp.from).success ? sp.from : null;
  const taskId = typeof sp.task === "string" && uuid.safeParse(sp.task).success ? sp.task : null;

  const supabase = await createClient();
  const roles = await getMemberRoles(supabase, profile.id);
  const [rates, { data: from }, classOptions, { data: task }, drafts] = await Promise.all([
    getRatesForRoles(
      supabase,
      roles.map((r) => r.id),
    ),
    fromId
      ? supabase
          .from("submissions")
          .select("role_id, rate_item_id, title, description, quantity, links")
          .eq("id", fromId)
          .eq("user_id", profile.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getClassOptions(supabase),
    taskId
      ? supabase
          .from("tasks")
          .select("id, title, description, role_id, exam_id, centre_id, quantity, status")
          .eq("id", taskId)
          .eq("assignee_id", profile.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getPaperDrafts(supabase, profile.id),
  ]);
  const marking = await getMarkingRates(supabase, profile.id);
  // A paper stage opened from "Ready to log": its role and page rate are known.
  const taskDraft = task ? drafts.find((d) => d.taskId === task.id) : undefined;
  const tags = activeOptions(classOptions, { examId: task?.exam_id });

  // The database decides the month (the month open when the work is approved).
  const workMonth = currentMonthKey();
  const roleOptions = roles.map((r) => ({ ...r, rates: rates.get(r.id) ?? [] }));
  const taskRole =
    task?.role_id && roles.some((r) => r.id === task.role_id) ? task.role_id : (taskDraft?.rate?.roleId ?? null);
  const copyRole = taskRole ?? (from && roles.some((r) => r.id === from.role_id) ? from.role_id : null);
  const defaultRole = copyRole ?? (roles.length === 1 ? roles[0].id : "");
  const defaultRates = rates.get(defaultRole) ?? [];
  const defaultRate =
    taskDraft?.rate && taskDraft.rate.roleId === defaultRole
      ? taskDraft.rate.rateItemId
      : from?.rate_item_id && defaultRates.some((r) => r.id === from.rate_item_id)
        ? from.rate_item_id
        : defaultRates.length === 1
          ? defaultRates[0].id
          : "";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={from ? "Log similar work" : "Submit work"}
        description={
          from
            ? "Copied from an earlier submission. Check the details and submit."
            : "Log a task you finished. An admin will review it."
        }
        actions={
          (marking.mcq || marking.essay || marking.full) && !task && !from ? (
            <Button asChild variant="outline">
              <Link href="/work/marking">
                <ClipboardPenIcon /> Log marked papers
              </Link>
            </Button>
          ) : undefined
        }
      />
      {!task && !from && <PaperDraftsCard drafts={toDraftItems(drafts)} showMoney={SHOW_MEMBERS_THEIR_EARNINGS} />}
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
              roles={roleOptions}
              today={todayISO()}
              showMoney={SHOW_MEMBERS_THEIR_EARNINGS}
              exams={tags.exams.map((e) => ({ id: e.id, label: e.label }))}
              centres={tags.centres.map((c) => ({ id: c.id, name: c.name }))}
              taskTitle={task?.title ?? null}
              defaultValues={{
                work_month: workMonth,
                role_id: defaultRole,
                rate_item_id: defaultRate,
                title: task?.title ?? from?.title ?? "",
                description: from?.description ?? "",
                quantity: taskDraft ? 1 : (task?.quantity ?? from?.quantity ?? 1),
                exam_id: task?.exam_id ?? "",
                centre_id: task?.centre_id ?? "",
                task_id: task?.id ?? "",
                date_done: todayISO(),
                links: (from?.links ?? []).map((url) => ({ url })),
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
