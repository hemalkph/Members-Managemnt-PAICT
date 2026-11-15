import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, BadgeCheckIcon, CheckCircle2Icon, CircleIcon, LockIcon, PencilIcon, RefreshCwIcon } from "lucide-react";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { CardDialog } from "@/components/students/card-dialog";
import { CertificateFiles } from "@/components/students/certificate-files";
import { DeleteStudentButton } from "@/components/students/delete-student-button";
import { Guardians } from "@/components/students/guardians";
import { ManualFlagBadge, ManualFlags } from "@/components/students/manual-flags";
import { Payments } from "@/components/students/payments";
import { ExamResultsList, MonthTimeline } from "@/components/students/timeline";
import { StudentDialog } from "@/components/students/student-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePage } from "@/lib/auth";
import { formatDate, formatDateTime, formatLKR } from "@/lib/core/format";
import { todayISO } from "@/lib/core/month";
import { uuid } from "@/lib/core/validation";
import { getClassOptions } from "@/lib/organisation/classes";
import { getStudentTimeline } from "@/lib/students/analysis";
import { FLAG_BADGE } from "@/lib/students/flags";
import { getConcessionStudent } from "@/lib/students/queries";
import { CARD_LABEL, STATUS_BADGE, STATUS_LABEL } from "@/lib/students/rules";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Concession student" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

export default async function StudentPage({ params }: PageProps<"/admin/students/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const { canEdit } = await requirePage("students");
  const supabase = await createClient();
  const [student, options] = await Promise.all([getConcessionStudent(supabase, id), getClassOptions(supabase)]);
  if (!student) notFound();
  const timeline = await getStudentTimeline(supabase, student);
  const openFlags = student.flags.filter((f) => !f.resolvedAt);

  const batch = options.batches.find((b) => b.id === student.batchId);
  const centre = options.centres.find((c) => c.id === student.centreId);
  // Keep the student's own batch / centre in the form even if it was switched off.
  const batches = options.batches.filter((b) => b.isActive || b.id === student.batchId).map((b) => ({ id: b.id, name: b.name }));
  const centres = options.centres.filter((c) => c.isActive || c.id === student.centreId).map((c) => ({ id: c.id, name: c.name }));

  const missing = new Set(student.missing);
  const checks = [
    { label: "GN certificate uploaded", ok: !missing.has("GN certificate file") },
    { label: "GN division", ok: !missing.has("GN division") },
    {
      label: missing.has("A certificate from the last 12 months") ? "Certificate is older than 12 months" : "Certificate date (last 12 months)",
      ok: !missing.has("Certificate date") && !missing.has("A certificate from the last 12 months"),
    },
    { label: "Parent occupation", ok: !missing.has("Parent occupation") },
    { label: "Parents' consent", ok: !missing.has("Parents' consent") },
    ...(student.card !== "free" ? [{ label: "Monthly amount", ok: !missing.has("Monthly amount") }] : []),
  ];
  const cardStudent = {
    id: student.id,
    card: student.card,
    status: student.status,
    updatedAt: student.updatedAt,
    missing: student.missing,
  };

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/students">
          <ArrowLeftIcon /> Concession students
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">{student.fullName}</h1>
          <p className="text-muted-foreground text-sm">
            {student.studentNo} · {batch?.name ?? "No batch"}
            {centre && ` · ${centre.name}`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{CARD_LABEL[student.card]}</Badge>
            <Badge variant={STATUS_BADGE[student.status]}>{STATUS_LABEL[student.status]}</Badge>
            {openFlags.map((f) => (
              <ManualFlagBadge key={f.id} kind={f.kind} />
            ))}
          </div>
          {timeline.flags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Automatic flags">
              {timeline.flags.map((f) => (
                <li key={f.key}>
                  <Badge variant={FLAG_BADGE[f.level]}>{f.label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <StudentDialog
              batches={batches}
              centres={centres}
              student={{
                id: student.id,
                expected_updated_at: student.updatedAt,
                student_no: student.studentNo,
                full_name: student.fullName,
                batch_id: student.batchId,
                centre_id: student.centreId ?? "",
                card_type: student.card,
                gn_division: student.gnDivision,
                certificate_issued_on: student.certificateIssuedOn ?? "",
                reason: student.reason,
                monthly_amount: student.monthlyAmount === null ? "" : String(student.monthlyAmount),
                consent_on: student.consentOn ?? "",
              }}
            >
              <Button variant="outline">
                <PencilIcon /> Edit
              </Button>
            </StudentDialog>
            <CardDialog student={cardStudent}>
              <Button variant="outline">
                <RefreshCwIcon /> Change card
              </Button>
            </CardDialog>
            {student.status === "applied" && !student.everVerified && (
              <DeleteStudentButton id={student.id} name={student.fullName} />
            )}
          </div>
        )}
      </div>
      {!canEdit && <ReadOnlyNotice />}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {student.status !== "ended" && (
            <Card>
              <CardHeader>
                <CardTitle>{student.missing.length === 0 ? "Ready to verify" : "Before verifying"}</CardTitle>
                <CardDescription>
                  {student.status === "verified"
                    ? student.missing.length === 0
                      ? `Verified by ${student.verifiedBy ?? "an admin"} on ${formatDate(student.verifiedAt)}.`
                      : "Verified, but something is now missing. Fix it or put the card under review."
                    : "The free-card guideline: a Grama Niladhari certificate of their area, the parents' occupations and consent."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="grid gap-2 sm:grid-cols-2">
                  {checks.map((c) => (
                    <li key={c.label} className="flex items-center gap-2 text-sm">
                      {c.ok ? (
                        <CheckCircle2Icon className="text-success size-4 shrink-0" aria-label="Done" />
                      ) : (
                        <CircleIcon className="text-muted-foreground size-4 shrink-0" aria-label="Missing" />
                      )}
                      <span className={c.ok ? undefined : "text-muted-foreground"}>{c.label}</span>
                    </li>
                  ))}
                </ul>
                {canEdit && student.status !== "verified" && (
                  <CardDialog student={cardStudent} initialStatus="verified">
                    <Button disabled={student.missing.length > 0}>
                      <BadgeCheckIcon /> Verify
                    </Button>
                  </CardDialog>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Last 12 months</CardTitle>
              <CardDescription>
                Exams of the batch they sat, absences and the average mark{student.card !== "free" && ", and payments"}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MonthTimeline months={timeline.months} showPayments={student.card !== "free"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Exam results</CardTitle>
            </CardHeader>
            <CardContent>
              <ExamResultsList exams={timeline.exams} />
            </CardContent>
          </Card>

          {student.card !== "free" && (
            <Card>
              <CardHeader>
                <CardTitle>Payments</CardTitle>
                <CardDescription>
                  {student.monthlyAmount !== null ? `${formatLKR(student.monthlyAmount)} a month. ` : ""}
                  Expected from the month they were verified.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Payments
                  studentId={student.id}
                  months={timeline.months.slice(0, 6)}
                  verifiedMonth={timeline.verifiedMonth}
                  monthlyAmount={student.monthlyAmount}
                  today={todayISO()}
                  canEdit={canEdit}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>GN certificate</CardTitle>
              <CardDescription>The Grama Niladhari certificate of the student&apos;s area.</CardDescription>
            </CardHeader>
            <CardContent>
              <CertificateFiles studentId={student.id} files={student.files} canEdit={canEdit} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Parents and guardians</CardTitle>
              <CardDescription>Names, occupations and phone numbers. Admins only.</CardDescription>
            </CardHeader>
            <CardContent>
              <Guardians studentId={student.id} guardians={student.guardians} canEdit={canEdit} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Flags</CardTitle>
              <CardDescription>Raised by admins, with the reason.</CardDescription>
            </CardHeader>
            <CardContent>
              <ManualFlags studentId={student.id} flags={student.flags} canEdit={canEdit} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LockIcon className="size-4" /> Private details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="GN division">{student.gnDivision || "—"}</Row>
                <Row label="Certificate date">{formatDate(student.certificateIssuedOn)}</Row>
                {student.card !== "free" && (
                  <Row label="Monthly amount">{student.monthlyAmount === null ? "—" : formatLKR(student.monthlyAmount)}</Row>
                )}
                <Row label="Parents' consent">{formatDate(student.consentOn)}</Row>
                <Row label="Registered">
                  {formatDate(student.createdAt)}
                  {student.createdBy && <span className="text-muted-foreground block text-xs">by {student.createdBy}</span>}
                </Row>
              </dl>
              {student.reason && (
                <div className="border-t pt-3">
                  <p className="text-muted-foreground text-sm">Why this card</p>
                  <p className="mt-1 text-sm whitespace-pre-line">{student.reason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
              <CardDescription>Every card and status change.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {student.history.map((h) => (
                  <li key={h.id} className="text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={STATUS_BADGE[h.status]}>{STATUS_LABEL[h.status]}</Badge>
                      <span className="text-muted-foreground text-xs">{CARD_LABEL[h.card]}</span>
                    </div>
                    {h.note && h.note !== STATUS_LABEL[h.status] && <p className="mt-1 break-words">{h.note}</p>}
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {formatDateTime(h.changedAt)}
                      {h.changedBy && ` · ${h.changedBy}`}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
