import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, CalendarClockIcon, CheckIcon, GraduationCapIcon, UserIcon } from "lucide-react";
import { PaperActions } from "@/components/papers/paper-actions";
import { PaperFileList, PaperFileUploader, type FileItem } from "@/components/papers/paper-files";
import { EditStageDialog, FinishStageButton } from "@/components/papers/stage-controls";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import Stepper from "@/components/reactbits/stepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { getPaper, getPaperFiles } from "@/lib/paper-queries";
import { paperSteps, STAGES } from "@/lib/papers";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { uuid } from "@/lib/validation";

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

  const [files, { data: stageTasks }, { data: profiles }] = await Promise.all([
    getPaperFiles(supabase, id),
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
  const current = paper.stages.find((s) => s.status === "in_progress");
  const myStage = paper.stages.find((s) => s.ownerId === profile.id && s.status === "in_progress");

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
          <Badge variant="outline" className="capitalize">
            {paper.kind}
          </Badge>
          {paper.status === "done" && <Badge variant="success">Finished</Badge>}
          {paper.status === "cancelled" && <Badge variant="secondary">Cancelled</Badge>}
        </div>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {paper.examLabel && (
            <span className="inline-flex items-center gap-1">
              <GraduationCapIcon className="size-4" /> {paper.examLabel}
            </span>
          )}
          <span>Added {formatDate(paper.createdAt)}</span>
          {paper.completedAt && <span>Finished {formatDate(paper.completedAt)}</span>}
        </p>
        {paper.notes && <p className="text-sm whitespace-pre-line">{paper.notes}</p>}
      </div>

      <Card>
        <CardContent className="px-3 sm:px-6">
          <Stepper steps={paperSteps(paper.stages, (d) => `due ${formatDate(d)}`)} />
        </CardContent>
      </Card>

      {myStage && taskByStage.get(myStage.id) && (
        <SpotlightCard className="border-primary/40 bg-primary/5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">It&apos;s your turn: {STAGES.find((s) => s.stage === myStage.stage)?.label}</p>
            <p className="text-muted-foreground text-sm">
              Upload your file below, then mark your stage as done so the next person can start.
              {myStage.dueDate && <> Due {formatDate(myStage.dueDate)}.</>}
            </p>
          </div>
          <FinishStageButton
            taskId={taskByStage.get(myStage.id)!.id}
            label={STAGES.find((s) => s.stage === myStage.stage)?.label ?? "Stage"}
          />
        </SpotlightCard>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {paper.stages.map((s, i) => {
          const meta = STAGES.find((x) => x.stage === s.stage)!;
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
                <Badge variant={s.overdue ? "destructive" : status.variant}>{s.overdue ? "Overdue" : status.label}</Badge>
              </div>
              <div className="text-muted-foreground space-y-1 text-sm">
                <p className="flex items-center gap-1.5">
                  <UserIcon className="size-4" /> {s.ownerName ?? (s.status === "skipped" ? "—" : "No owner yet")}
                </p>
                {s.dueDate && s.status !== "skipped" && (
                  <p className={cn("flex items-center gap-1.5", s.overdue && "text-destructive font-medium")}>
                    <CalendarClockIcon className="size-4" /> Due {formatDate(s.dueDate)}
                  </p>
                )}
                {s.completedAt && (
                  <p className="text-success flex items-center gap-1.5">
                    <CheckIcon className="size-4" /> Done {formatDate(s.completedAt)}
                  </p>
                )}
              </div>
              {profile.is_admin && paper.status === "in_progress" && s.status !== "done" && (
                <div className="mt-auto">
                  <EditStageDialog
                    paperId={paper.id}
                    stageId={s.id}
                    label={meta.label}
                    ownerId={s.ownerId}
                    dueDate={s.dueDate}
                    status={s.status}
                    members={members}
                  />
                </div>
              )}
            </SpotlightCard>
          );
        })}
      </div>

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <CardDescription>Every upload is kept as a new version, so earlier drafts are never lost.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {paper.status !== "cancelled" && (
            <PaperFileUploader paperId={paper.id} defaultStage={(myStage ?? current)?.stage ?? "created"} />
          )}
          <PaperFileList files={fileItems} />
        </CardContent>
      </Card>
    </div>
  );
}
