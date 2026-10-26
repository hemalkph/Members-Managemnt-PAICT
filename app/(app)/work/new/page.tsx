import type { Metadata } from "next";
import { CalendarClockIcon, LockIcon, UserRoundXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SubmissionForm } from "@/components/member/submission-form";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { requireCompleteProfile } from "@/lib/auth";
import { SHOW_MEMBERS_THEIR_EARNINGS } from "@/lib/config";
import { monthLabel, parseMonthParam, recentMonths, todayISO } from "@/lib/month";
import { activeOptions, getClassOptions } from "@/lib/classes";
import { getDeadlines } from "@/lib/deadlines";
import { getClosedMonthKeys } from "@/lib/payments";
import { getMemberRoles, getRatesForRoles } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Submit work" };

export default async function NewWorkPage({ searchParams }: PageProps<"/work/new">) {
  const profile = await requireCompleteProfile();
  const sp = await searchParams;
  const month = parseMonthParam(sp.month);
  const fromId = typeof sp.from === "string" && uuid.safeParse(sp.from).success ? sp.from : null;
  const taskId = typeof sp.task === "string" && uuid.safeParse(sp.task).success ? sp.task : null;

  const supabase = await createClient();
  const roles = await getMemberRoles(supabase, profile.id);
  const [rates, { data: from }, closedMonths, classOptions, { data: task }] = await Promise.all([
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
    getClosedMonthKeys(supabase),
    getClassOptions(supabase),
    taskId
      ? supabase
          .from("tasks")
          .select("id, title, description, role_id, exam_id, centre_id, quantity, status")
          .eq("id", taskId)
          .eq("assignee_id", profile.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const tags = activeOptions(classOptions, { examId: task?.exam_id });

  // Closed months (already paid out) can't take new work, and members can't
  // log work after a month's deadline (admins can).
  const closed = new Set(closedMonths);
  const candidates = recentMonths(12, true);
  if (!candidates.includes(month)) candidates.push(month);
  const deadlines = profile.is_admin ? new Map() : await getDeadlines(supabase, candidates);
  const isLocked = (m: string) => closed.has(m) || Boolean(deadlines.get(m)?.passed);
  const months = candidates.filter((m) => !isLocked(m)).sort().reverse();
  const workMonth = isLocked(month) ? (months.find((m) => m <= month) ?? months[0]) : month;
  const requestedDeadline = deadlines.get(month);
  const roleOptions = roles.map((r) => ({ ...r, rates: rates.get(r.id) ?? [] }));
  const taskRole = task?.role_id && roles.some((r) => r.id === task.role_id) ? task.role_id : null;
  const copyRole = taskRole ?? (from && roles.some((r) => r.id === from.role_id) ? from.role_id : null);
  const defaultRole = copyRole ?? (roles.length === 1 ? roles[0].id : "");
  const defaultRates = rates.get(defaultRole) ?? [];
  const defaultRate =
    from?.rate_item_id && defaultRates.some((r) => r.id === from.rate_item_id)
      ? from.rate_item_id
      : defaultRates.length === 1
        ? defaultRates[0].id
        : "";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={from ? "Log similar work" : "Submit work"}
        description={
          from ? "Copied from an earlier submission. Check the details and submit." : "Log a task you finished. An admin will review it."
        }
      />
      {!closed.has(month) && requestedDeadline?.passed && (
        <Alert variant="warning">
          <CalendarClockIcon />
          <AlertTitle>The {monthLabel(month)} deadline has passed</AlertTitle>
          <AlertDescription>
            Work for {monthLabel(month)} had to be logged by {requestedDeadline.lastDayLabel}. If you missed something,
            ask an admin.
          </AlertDescription>
        </Alert>
      )}
      {closed.has(month) && (
        <Alert variant="warning">
          <LockIcon />
          <AlertTitle>{monthLabel(month)} is closed</AlertTitle>
          <AlertDescription>
            Payments for that month are done, so new work goes into an open month. Ask a main admin if something was
            missed.
          </AlertDescription>
        </Alert>
      )}
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
              months={months}
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
                quantity: task?.quantity ?? from?.quantity ?? 1,
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
