import type { Metadata } from "next";
import { InboxIcon, LockIcon } from "lucide-react";
import type { ReviewRow } from "@/components/admin/review-dialog";
import { ReviewFilters } from "@/components/admin/review-filters";
import { ReviewTable } from "@/components/admin/review-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAdmin } from "@/lib/auth";
import { dateToMonthKey, monthKeyToDate, monthLabel, parseMonthParam } from "@/lib/month";
import { getPayMonth } from "@/lib/payments";
import { getStructure } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Work review" };

const STATUSES = ["pending", "approved", "rejected"] as const;

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function ReviewPage({ searchParams }: PageProps<"/admin/review">) {
  await requireAdmin();
  const sp = await searchParams;
  const month = parseMonthParam(sp.month);
  const status = STATUSES.find((s) => s === param(sp.status));
  const member = uuid.safeParse(param(sp.member)).success ? param(sp.member) : null;
  const role = uuid.safeParse(param(sp.role)).success ? param(sp.role) : null;
  const section = uuid.safeParse(param(sp.section)).success ? param(sp.section) : null;

  const supabase = await createClient();
  const [structure, { data: members }, payMonth] = await Promise.all([
    getStructure(supabase),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
    getPayMonth(supabase, month),
  ]);

  let query = supabase
    .from("submissions")
    .select(
      "id, title, description, quantity, date_done, links, status, admin_comment, reviewed_at, created_at, work_month, member:profiles!submissions_user_id_fkey(full_name, email), reviewer:profiles!submissions_reviewed_by_fkey(full_name), roles(name, sections(name)), rate_items(name, unit), exam:exams(name, batch:batches(name)), centre:centres(name), unit_price, amount, submission_attachments(id, file_name, size_bytes)",
    )
    .eq("work_month", monthKeyToDate(month))
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (member) query = query.eq("user_id", member);
  if (role) query = query.eq("role_id", role);
  else if (section) {
    const ids = structure.find((s) => s.id === section)?.roles.map((r) => r.id) ?? [];
    query = query.in("role_id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }

  const { data } = await query;
  const rows: ReviewRow[] = (data ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    quantity: s.quantity,
    date_done: s.date_done,
    links: s.links,
    status: s.status,
    admin_comment: s.admin_comment,
    reviewed_at: s.reviewed_at,
    created_at: s.created_at,
    month: dateToMonthKey(s.work_month),
    memberName: s.member?.full_name || s.member?.email || "Unknown",
    memberEmail: s.member?.email ?? "",
    roleName: s.roles?.name ?? "—",
    sectionName: s.roles?.sections?.name ?? "—",
    reviewerName: s.reviewer?.full_name ?? null,
    workType: s.rate_items?.name ?? null,
    examLabel: s.exam ? `${s.exam.batch?.name ? `${s.exam.batch.name} – ` : ""}${s.exam.name}` : null,
    centreName: s.centre?.name ?? null,
    unit: s.rate_items?.unit ?? null,
    unitPrice: s.unit_price === null ? null : Number(s.unit_price),
    amount: s.amount === null ? null : Number(s.amount),
    attachments: s.submission_attachments,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Work review" description="Open a submission to see details, then approve or reject it." />
      <ReviewFilters
        month={month}
        sections={structure.map((s) => ({ id: s.id, name: s.name, roles: s.roles.map((r) => ({ id: r.id, name: r.name })) }))}
        members={(members ?? []).map((m) => ({ id: m.id, name: m.full_name || m.email }))}
      />
      {payMonth && (
        <Alert>
          <LockIcon />
          <AlertTitle>{monthLabel(month)} is closed for payments</AlertTitle>
          <AlertDescription>
            Reviews for this month are locked. A main admin can reopen the month from Payments if something needs to
            change.
          </AlertDescription>
        </Alert>
      )}
      {rows.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="Nothing to show"
          description={`No submissions match these filters for ${monthLabel(month)}.`}
        />
      ) : (
        <ReviewTable rows={rows} />
      )}
    </div>
  );
}
