import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  CheckIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  SendIcon,
  UserIcon,
} from "lucide-react";
import { PaperActions } from "@/components/papers/paper-actions";
import { PaperFileList, PaperFileUploader, type FileItem } from "@/components/papers/paper-files";
import { ReviewContacts, type PaperContact } from "@/components/papers/review-contacts";
import {
  EditStageDialog,
  FinishStageButton,
  HandoverLinksForm,
  StageLinkDialog,
} from "@/components/papers/stage-controls";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import Stepper from "@/components/reactbits/stepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getSiteUrl } from "@/lib/env";
import { formatDate, formatDateTime, formatDay, formatDayRange } from "@/lib/format";
import { getPaper, getPaperFiles } from "@/lib/paper-queries";
import { MEDIUM_LABEL, onlineExamDay, PAID_PAGE_STAGES, PART_LABEL, paperSteps, STAGE_META } from "@/lib/papers";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { UPLOAD_STAGES, uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Paper" };

const STATUS_TEXT = {
  waiting: { label: "Waiting", variant: "secondary" as const },
  in_progress: { label: "In progress", variant: "default" as const },
  done: { label: "Done", variant: "success" as const },
  skipped: { label: "Skipped", variant: "outline" as const },
};

export default async function PaperPage({ params }: PageProps<"/papers/[id]">) {
  const profile = await requireUser();
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const supabase = await createClient();
  const paper = await getPaper(supabase, id);
  if (!paper) notFound();

  const [files, { data: contactRows }, { data: stageTasks }, { data: profiles }] = await Promise.all([
    getPaperFiles(supabase, id),
    supabase.rpc("paper_contacts", { p_paper: id }),
    supabase
      .from("tasks")
      .select("id, paper_stage_id, status, assignee_id")
      .in(
        "paper_stage_id",
        paper.stages.map((s) => s.id),
      ),
    profile.is_admin
      ? supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string; email: string }[] }),
  ]);
  const taskByStage = new Map((stageTasks ?? []).map((t) => [t.paper_stage_id, t]));
  const members = (profiles ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email }));
  const myTurn = paper.stages.filter(
    (s) => s.ownerId === profile.id && s.status === "in_progress" && taskByStage.get(s.id),
  );
  const handover = paper.stages.find((s) => s.stage === "handover");

  // Files move between members only until English type setting; from review on, WhatsApp.
  const reviewReached = paper.stages.some(
    (s) =>
      ["review_si", "review_en", "handover"].includes(s.stage) && (s.status === "in_progress" || s.status === "done"),
  );
  // Each medium takes files until its own review starts: Sinhala files until the
  // Sinhala review, the English draft and English type setting until the English review.
  const reviewOf: Record<string, string> = {
    create_si: "review_si",
    typeset_si: "review_si",
    convert: "review_en",
    typeset_en: "review_en",
  };
  const reviewStarted = (stage: string) => {
    const review = paper.stages.find((s) => s.stage === reviewOf[stage]);
    return Boolean(review && (review.status === "in_progress" || review.status === "done"));
  };
  const uploadStages = paper.stages
    .filter(
      (s) =>
        (UPLOAD_STAGES as readonly string[]).includes(s.stage) && s.status !== "skipped" && !reviewStarted(s.stage),
    )
    .map((s) => ({
      stage: s.stage,
      label: STAGE_META[s.stage].label,
      mine: s.ownerId === profile.id,
      active: s.status === "in_progress",
    }));
  const canUpload = paper.status === "in_progress" && uploadStages.length > 0;
  const defaultUpload =
    uploadStages.find((s) => s.mine && s.active) ?? uploadStages.find((s) => s.active) ?? uploadStages[0];
  const latestVersion = new Map<string, number>();
  for (const f of files) latestVersion.set(f.stage, Math.max(latestVersion.get(f.stage) ?? 0, f.version));
  const fileItems: FileItem[] = files.map((f) => ({
    id: f.id,
    stage: f.stage,
    version: f.version,
    fileName: f.fileName,
    sizeBytes: f.sizeBytes,
    note: f.note,
    uploadedBy: f.uploadedBy,
    canDelete: profile.is_admin || f.uploadedById === profile.id,
    when: formatDateTime(f.createdAt),
    latest: latestVersion.get(f.stage) === f.version,
  }));

  // The people on this paper (not me), with what they do on it.
  const ROLE: Record<string, string> = {
    create_si: "Paper creator",
    convert: "Converter",
    typeset_si: "Type setter",
    typeset_en: "Type setter",
    handover: "Type setter",
    review_si: "Reviewer",
    review_en: "Reviewer",
  };
  const contactMap = new Map<string, PaperContact>();
  for (const c of contactRows ?? []) {
    if (c.user_id === profile.id || !ROLE[c.stage]) continue;
    const entry = contactMap.get(c.user_id) ?? {
      userId: c.user_id,
      name: c.full_name,
      roles: [],
      whatsapp: c.whatsapp,
    };
    if (!entry.roles.includes(ROLE[c.stage])) entry.roles.push(ROLE[c.stage]);
    contactMap.set(c.user_id, entry);
  }
  // A creator who also reviews is just "Paper creator".
  const contacts = [...contactMap.values()].map((c) => ({
    ...c,
    roles: c.roles.length > 1 ? c.roles.filter((r) => r !== "Reviewer") : c.roles,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" className="-ml-3">
          <Link href={profile.is_admin ? "/admin/papers" : "/tasks"}>
            <ArrowLeftIcon /> {profile.is_admin ? "Papers" : "My tasks"}
          </Link>
        </Button>
        {profile.is_admin && <PaperActions paperId={paper.id} title={paper.title} status={paper.status} />}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{paper.title}</h1>
          {paper.kind === "tute" ? (
            <Badge variant="outline">Tute</Badge>
          ) : (
            <Badge variant="outline">{PART_LABEL[paper.part]}</Badge>
          )}
          <Badge variant="secondary">{MEDIUM_LABEL[paper.medium]}</Badge>
          {paper.status === "done" && <Badge variant="success">Finished</Badge>}
          {paper.status === "cancelled" && <Badge variant="secondary">Cancelled</Badge>}
        </div>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {paper.examLabel && (
            <span className="inline-flex items-center gap-1">
              <GraduationCapIcon className="size-4" /> {paper.examLabel}
            </span>
          )}
          {paper.examDay && (
            <span className="inline-flex items-center gap-1">
              <CalendarDaysIcon className="size-4" />
              {paper.kind === "tute" ? (
                <>Release {formatDay(paper.examDay)}</>
              ) : (
                <>
                  Physical centres {formatDay(paper.examDay)} · Online {formatDay(onlineExamDay(paper.examDay))}
                </>
              )}
            </span>
          )}
          <span>Added {formatDate(paper.createdAt)}</span>
          {paper.completedAt && <span>Finished {formatDate(paper.completedAt)}</span>}
        </p>
        {paper.notes && <p className="text-sm whitespace-pre-line">{paper.notes}</p>}
      </div>

      <Card>
        <CardContent className="overflow-x-auto px-3 sm:px-6">
          <Stepper steps={paperSteps(paper.stages, (d) => `due ${formatDay(d)}`)} />
        </CardContent>
      </Card>

      {myTurn.map((st) => {
        const meta = STAGE_META[st.stage];
        return (
          <SpotlightCard
            key={st.id}
            className="border-primary/40 bg-primary/5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="space-y-1">
              <p className="font-semibold">It&apos;s your turn: {meta.label}</p>
              <p className="text-muted-foreground text-sm">{meta.howTo}</p>
              {(st.startDate || st.dueDate) && (
                <p className={cn("text-sm font-medium", st.overdue && "text-destructive")}>
                  Work {st.startDate && st.startDate !== st.dueDate ? "days" : "day"}:{" "}
                  {formatDayRange(st.startDate, st.dueDate)}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {st.stage !== "handover" && (
                <StageLinkDialog paperId={paper.id} stageId={st.id} label={meta.label} link={st.link} />
              )}
              <FinishStageButton
                taskId={taskByStage.get(st.id)!.id}
                label={meta.label}
                logPages={PAID_PAGE_STAGES.includes(st.stage)}
              />
            </div>
          </SpotlightCard>
        );
      })}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {paper.stages.map((s, i) => {
          const meta = STAGE_META[s.stage];
          const status = STATUS_TEXT[s.status];
          return (
            <SpotlightCard
              key={s.id}
              className={cn(
                "flex flex-col gap-3 p-4",
                s.status === "in_progress" && "border-primary/50",
                s.overdue && "border-destructive/50 bg-destructive/5",
                s.status === "skipped" && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-muted-foreground text-xs">Stage {i + 1}</p>
                  <p className="font-semibold">{meta.label}</p>
                </div>
                <Badge variant={s.overdue ? "destructive" : status.variant}>
                  {s.overdue ? "Overdue" : status.label}
                </Badge>
              </div>
              <div className="text-muted-foreground space-y-1 text-sm">
                <p className="flex items-center gap-1.5">
                  <UserIcon className="size-4" /> {s.ownerName ?? (s.status === "skipped" ? "—" : "No owner yet")}
                </p>
                {(s.startDate || s.dueDate) && s.status !== "skipped" && (
                  <p className={cn("flex items-center gap-1.5", s.overdue && "text-destructive font-medium")}>
                    <CalendarClockIcon className="size-4 shrink-0" /> {formatDayRange(s.startDate, s.dueDate)}
                  </p>
                )}
                {s.completedAt && (
                  <p className="text-success flex items-center gap-1.5">
                    <CheckIcon className="size-4" /> Done {formatDate(s.completedAt)}
                  </p>
                )}
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                {s.link && (
                  <Button asChild size="sm" variant="outline">
                    <a href={s.link} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon /> Open work
                    </a>
                  </Button>
                )}
                {(profile.is_admin || s.ownerId === profile.id) &&
                  s.status !== "skipped" &&
                  s.stage !== "handover" &&
                  paper.status !== "cancelled" &&
                  !myTurn.some((t) => t.id === s.id) && (
                    <StageLinkDialog paperId={paper.id} stageId={s.id} label={meta.label} link={s.link} />
                  )}
                {profile.is_admin && paper.status === "in_progress" && s.status !== "done" && (
                  <EditStageDialog
                    paperId={paper.id}
                    stageId={s.id}
                    label={meta.label}
                    ownerId={s.ownerId}
                    startDate={s.startDate}
                    dueDate={s.dueDate}
                    status={s.status}
                    members={members}
                  />
                )}
              </div>
            </SpotlightCard>
          );
        })}
      </div>

      {reviewReached && paper.status !== "cancelled" && (
        <ReviewContacts contacts={contacts} paperTitle={paper.title} paperUrl={`${getSiteUrl()}/papers/${paper.id}`} />
      )}

      {(canUpload || fileItems.length > 0) && (
        <Card className="gap-4">
          <CardHeader>
            <CardTitle>Files</CardTitle>
            <CardDescription>
              {canUpload
                ? "Pass drafts to the next member here – e.g. the converter uploads the English draft for English type setting. Every upload is kept as a new version. Each medium's uploads stop when its review starts."
                : "Drafts shared before the review. From the review stage on, files are sent on WhatsApp instead."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {canUpload && defaultUpload && (
              <PaperFileUploader
                paperId={paper.id}
                defaultStage={defaultUpload.stage}
                stages={uploadStages.map(({ stage, label }) => ({ stage, label }))}
              />
            )}
            <PaperFileList files={fileItems} />
          </CardContent>
        </Card>
      )}

      {handover && handover.status !== "skipped" && (
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SendIcon className="text-primary size-5" /> Hand over
              {paper.handedOverAt && <Badge variant="success">Handed over {formatDate(paper.handedOverAt)}</Badge>}
            </CardTitle>
            <CardDescription>
              The type setter sends the corrected final PDF to the LMS admin and physical coordinator WhatsApp groups.
              PDFs are not uploaded here, so storage stays small
              {profile.is_admin ? " – paste the two message links below" : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(paper.lmsLink || paper.physicalLink) && (
              <div className="flex flex-wrap gap-2">
                {paper.lmsLink && (
                  <Button asChild variant="outline" size="sm">
                    <a href={paper.lmsLink} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon /> LMS admin group
                    </a>
                  </Button>
                )}
                {paper.physicalLink && (
                  <Button asChild variant="outline" size="sm">
                    <a href={paper.physicalLink} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon /> Physical coordinator group
                    </a>
                  </Button>
                )}
              </div>
            )}
            {profile.is_admin ? (
              <HandoverLinksForm paperId={paper.id} lmsLink={paper.lmsLink} physicalLink={paper.physicalLink} />
            ) : (
              !paper.lmsLink &&
              !paper.physicalLink && <p className="text-muted-foreground text-sm">No hand-over links yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
