import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  CheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  LibraryIcon,
  MessageCircleIcon,
  SendIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { MyStagePanel, type MyStage } from "@/components/papers/my-stage-panel";
import { PaperActions } from "@/components/papers/paper-actions";
import { PaperFileList, PaperFileUploader, type FileItem } from "@/components/papers/paper-files";
import { PaperNotes, type NoteItem } from "@/components/papers/paper-notes";
import { ReviewContacts, waNumber, type PaperContact } from "@/components/papers/review-contacts";
import { EditStageDialog, StageLinkDialog } from "@/components/papers/stage-controls";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import Stepper from "@/components/reactbits/stepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { effectivePageAccess, requireUser } from "@/lib/auth";
import { getSiteUrl } from "@/lib/env";
import { formatDate, formatDateTime, formatDay, formatDayRange } from "@/lib/format";
import { getPaper, getPaperFiles } from "@/lib/paper-queries";
import {
  FINAL_STAGES,
  MEDIUM_LABEL,
  onlineExamDay,
  PAID_PAGE_STAGES,
  PART_LABEL,
  paperSteps,
  STAGE_INPUTS,
  STAGE_META,
} from "@/lib/papers";
import { createClient } from "@/lib/supabase/server";
import { getTeamDirectory, teamNames } from "@/lib/team-directory";
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
  // Papers page access: "edit" can change any paper, "view" can see every paper.
  const papersAccess = await effectivePageAccess(profile, "papers");
  const canManage = papersAccess === "edit";
  const team = papersAccess !== "none" ? await getTeamDirectory(supabase) : [];
  const paper = await getPaper(supabase, id, teamNames(team));
  if (!paper) notFound();

  const [files, { data: contactRows }, { data: stageTasks }, { data: profiles }, { data: noteRows }, { data: links }] =
    await Promise.all([
      getPaperFiles(supabase, id),
      supabase.rpc("paper_contacts", { p_paper: id }),
      supabase
        .from("tasks")
        .select("id, paper_stage_id, status, assignee_id")
        .in(
          "paper_stage_id",
          paper.stages.map((s) => s.id),
        ),
      Promise.resolve({ data: canManage ? team.filter((m) => m.isActive) : [] }),
      supabase
        .from("paper_notes")
        .select("id, stage, author_id, body, created_at")
        .eq("paper_id", id)
        .order("created_at")
        .limit(500),
      supabase.rpc("group_links"),
    ]);
  const groupLinks = { lms: links?.[0]?.lms_group_link ?? null, physical: links?.[0]?.physical_group_link ?? null };
  const taskByStage = new Map((stageTasks ?? []).map((t) => [t.paper_stage_id, t]));
  const members = (profiles ?? []).map((p) => ({ id: p.id, name: p.name }));
  const handover = paper.stages.find((s) => s.stage === "handover");

  // Every stage takes files (reviewers can upload a marked PDF; hand over takes the final PDFs).
  const uploadStages = paper.stages
    .filter((s) => (UPLOAD_STAGES as readonly string[]).includes(s.stage) && s.status !== "skipped")
    .map((s) => ({
      stage: s.stage,
      label: STAGE_META[s.stage].label,
      mine: s.ownerId === profile.id,
      active: s.status === "in_progress",
    }));
  const onPaper = paper.stages.some((s) => s.ownerId === profile.id);
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
    canDelete: canManage || f.uploadedById === profile.id,
    when: formatDateTime(f.createdAt),
    latest: latestVersion.get(f.stage) === f.version,
  }));

  // Names of the people on this paper (members can't read other profiles).
  const nameOf = new Map<string, string>((contactRows ?? []).map((c) => [c.user_id, c.full_name]));
  for (const m of team) nameOf.set(m.id, m.name);
  nameOf.set(profile.id, profile.full_name || profile.email);
  const notes: (NoteItem & { stage: string | null })[] = (noteRows ?? []).map((n) => ({
    id: n.id,
    stage: n.stage,
    author: (n.author_id && nameOf.get(n.author_id)) || (n.author_id ? "Admin" : "Former member"),
    stageLabel: n.stage ? (STAGE_META[n.stage as keyof typeof STAGE_META]?.label ?? null) : null,
    body: n.body,
    when: formatDateTime(n.created_at),
    canDelete: canManage || n.author_id === profile.id,
    mine: n.author_id === profile.id,
  }));
  // The corrections each stage has to fix.
  const FIXES: Partial<Record<string, string[]>> = {
    typeset_si: ["review_si"],
    typeset_en: ["review_en"],
    handover: ["review_si", "review_en"],
    scheme_rewrite: ["scheme"],
    scheme_en: ["scheme"],
  };
  const isReview = (stage: string) => stage === "review_si" || stage === "review_en";

  // "Your part": my active stages, plus finished ones that never shared a file
  // and can still take one (e.g. the converter marked done before uploading).
  const finals = fileItems.filter((f) => f.latest && (FINAL_STAGES as string[]).includes(f.stage));
  const latestFile = (stage: string) => fileItems.find((f) => f.stage === stage && f.latest) ?? null;
  const openForUpload = new Set(uploadStages.map((u) => u.stage as string));
  const myStages: MyStage[] =
    paper.status === "in_progress"
      ? paper.stages
          .filter((s) => s.ownerId === profile.id)
          .filter(
            (s) =>
              s.status === "in_progress" ||
              (s.status === "done" &&
                openForUpload.has(s.stage) &&
                !latestFile(s.stage) &&
                !s.link &&
                !(isReview(s.stage) && notes.some((n) => n.stage === s.stage && n.mine))),
          )
          .map((s) => ({
            stageId: s.id,
            stage: s.stage,
            number: s.position,
            label: STAGE_META[s.stage].label,
            howTo: STAGE_META[s.stage].howTo,
            workDays: s.startDate || s.dueDate ? formatDayRange(s.startDate, s.dueDate) : null,
            overdue: s.overdue,
            status: s.status === "done" ? ("done" as const) : ("in_progress" as const),
            inputs: STAGE_INPUTS[s.stage]
              .map((from) => paper.stages.find((x) => x.stage === from))
              .filter((x): x is NonNullable<typeof x> => Boolean(x) && x!.status !== "skipped")
              // Reviews send corrections as notes; show them as an input only when a marked PDF was uploaded.
              .filter((x) => !isReview(x.stage) || Boolean(latestFile(x.stage)))
              .map((x) => ({
                stageLabel: STAGE_META[x.stage].label,
                ownerName: x.ownerName,
                done: x.status === "done",
                file: latestFile(x.stage),
                link: x.link,
              })),
            uploadOpen: openForUpload.has(s.stage),
            myFile: latestFile(s.stage),
            myLink: s.link,
            review: isReview(s.stage),
            myNotes: notes.filter((n) => n.stage === s.stage && n.mine).length,
            corrections: notes.filter((n) => n.stage && (FIXES[s.stage] ?? []).includes(n.stage)),
            groupLinks: s.stage === "handover" ? groupLinks : null,
            taskId: s.status === "in_progress" ? (taskByStage.get(s.id)?.id ?? null) : null,
            logPages: PAID_PAGE_STAGES.includes(s.stage),
          }))
      : [];

  // The people on this paper (not me), with what they do on it.
  const ROLE: Record<string, string> = {
    create_si: "Paper creator",
    convert: "Converter",
    typeset_si: "Type setter",
    typeset_en: "Type setter",
    handover: "Type setter",
    review_si: "Reviewer",
    review_en: "Reviewer",
    scheme: "Marking scheme",
    scheme_rewrite: "Marking team",
    scheme_en: "Translator",
  };
  // Admins: WhatsApp for whoever owns a late stage.
  const phoneOf = new Map((contactRows ?? []).map((c) => [c.user_id, waNumber(c.whatsapp)]));
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
          <Link href={papersAccess !== "none" ? "/admin/papers" : "/tasks"}>
            <ArrowLeftIcon /> {papersAccess !== "none" ? "Papers" : "My tasks"}
          </Link>
        </Button>
        {canManage && <PaperActions paperId={paper.id} title={paper.title} status={paper.status} />}
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

      {myStages.length > 0 && (
        <div className={cn("grid gap-4", myStages.length > 1 && "lg:grid-cols-2")}>
          {myStages.map((st) => (
            <MyStagePanel key={st.stageId} paperId={paper.id} stage={st} />
          ))}
        </div>
      )}

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
                {canManage && s.overdue && s.ownerId && s.ownerId !== profile.id && phoneOf.get(s.ownerId) && (
                  <Button asChild size="sm" className="bg-[#0f7a6e] text-white hover:bg-[#0c675d]">
                    <a
                      href={`https://wa.me/${phoneOf.get(s.ownerId)}?text=${encodeURIComponent(
                        `Hi ${(s.ownerName ?? "").split(" ")[0]}, "${paper.title}" – ${meta.label} was due ${s.dueDate ? formatDay(s.dueDate) : "already"}. Can you finish it today? ${getSiteUrl()}/papers/${paper.id}`,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MessageCircleIcon /> WhatsApp {(s.ownerName ?? "").split(" ")[0]}
                    </a>
                  </Button>
                )}
                {latestFile(s.stage) && (
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={`/papers/files/${latestFile(s.stage)!.id}?download=1`}
                      title={latestFile(s.stage)!.fileName}
                    >
                      <DownloadIcon /> Download v{latestFile(s.stage)!.version}
                    </a>
                  </Button>
                )}
                {s.link && (
                  <Button asChild size="sm" variant="outline">
                    <a href={s.link} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon /> Open work
                    </a>
                  </Button>
                )}
                {(canManage || s.ownerId === profile.id) &&
                  s.status !== "skipped" &&
                  s.stage !== "handover" &&
                  paper.status !== "cancelled" &&
                  !myStages.some((t) => t.stageId === s.id) && (
                    <StageLinkDialog paperId={paper.id} stageId={s.id} label={meta.label} link={s.link} />
                  )}
                {canManage && paper.status === "in_progress" && s.status !== "done" && (
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

      {paper.status !== "cancelled" && (onPaper || canManage) && (
        <PaperNotes
          paperId={paper.id}
          notes={notes}
          stages={paper.stages
            .filter((s) => s.status !== "skipped" && s.stage !== "mark")
            .map((s) => ({ stage: s.stage, label: STAGE_META[s.stage].label }))}
          defaultStage={myStages.find((m) => m.review && m.status === "in_progress")?.stage}
          canWrite={paper.status === "in_progress"}
        />
      )}

      {paper.status !== "cancelled" && contacts.length > 0 && (
        <ReviewContacts contacts={contacts} paperTitle={paper.title} paperUrl={`${getSiteUrl()}/papers/${paper.id}`} />
      )}

      {paper.filesClearedAt && (
        <p className="text-muted-foreground rounded-xl border border-dashed p-3 text-sm">
          {paper.filesClearedCount ?? ""} draft file{paper.filesClearedCount === 1 ? " was" : "s were"} deleted (last on{" "}
          {formatDate(paper.filesClearedAt)}) to keep storage small. The final outputs are kept in the Paper library.
        </p>
      )}

      {(canUpload || fileItems.length > 0) && (
        <Card className="gap-4">
          <CardHeader>
            <CardTitle>Files</CardTitle>
            <CardDescription>
              Every file shared on this paper, newest version first. Members upload from &quot;Your part&quot; above.
              Drafts are deleted some days after hand-over; the final PDFs and marking schemes are kept.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {canManage && canUpload && defaultUpload && (
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
              <SendIcon className="text-primary size-5" /> Final outputs
              {paper.handedOverAt && <Badge variant="success">Handed over {formatDate(paper.handedOverAt)}</Badge>}
            </CardTitle>
            <CardDescription>
              The final PDFs and marking schemes. They are kept for good and every member can download them from the
              Paper library.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {finals.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {finals.map((f) => (
                  <Button key={f.id} asChild variant="outline" size="sm">
                    <a href={`/papers/files/${f.id}?download=1`} title={f.fileName}>
                      <DownloadIcon /> {STAGE_META[f.stage as keyof typeof STAGE_META]?.label ?? f.stage} · v{f.version}
                    </a>
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No final PDF uploaded yet.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {groupLinks.lms && (
                <Button asChild size="sm" className="bg-[#0f7a6e] text-white hover:bg-[#0c675d]">
                  <a href={groupLinks.lms} target="_blank" rel="noreferrer">
                    <UsersIcon /> LMS admin group
                  </a>
                </Button>
              )}
              {groupLinks.physical && (
                <Button asChild size="sm" className="bg-[#0f7a6e] text-white hover:bg-[#0c675d]">
                  <a href={groupLinks.physical} target="_blank" rel="noreferrer">
                    <UsersIcon /> Physical coordinator group
                  </a>
                </Button>
              )}
              <Button asChild size="sm" variant="ghost">
                <Link href="/library">
                  <LibraryIcon /> Paper library
                </Link>
              </Button>
              {canManage && !groupLinks.lms && !groupLinks.physical && (
                <span className="text-muted-foreground text-xs">Add the group links on the Papers page.</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
