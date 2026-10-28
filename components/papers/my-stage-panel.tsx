import { CheckIcon, DownloadIcon, ExternalLinkIcon, FileIcon, MessageSquareTextIcon, UsersIcon } from "lucide-react";
import { NoteForm, type NoteItem } from "@/components/papers/paper-notes";
import { PaperFileUploader, type FileItem } from "@/components/papers/paper-files";
import { FinishStageButton, StageLinkDialog } from "@/components/papers/stage-controls";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PaperStageName } from "@/lib/database.types";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export type StageInput = {
  stageLabel: string;
  ownerName: string | null;
  done: boolean;
  /** Latest version only. */
  file: FileItem | null;
  link: string | null;
};

export type MyStage = {
  stageId: string;
  stage: PaperStageName;
  number: number;
  label: string;
  howTo: string;
  workDays: string | null;
  overdue: boolean;
  status: "in_progress" | "done";
  inputs: StageInput[];
  /** This stage takes uploads right now. */
  uploadOpen: boolean;
  myFile: FileItem | null;
  myLink: string | null;
  /** Review stages: corrections are written in the system (or a marked PDF is uploaded). */
  review: boolean;
  /** How many corrections I wrote for this review stage. */
  myNotes: number;
  /** Reviewers' corrections this stage has to fix (type setting and hand over). */
  corrections: NoteItem[];
  /** Hand over: the WhatsApp groups the final PDFs are shared in. */
  groupLinks: { lms: string | null; physical: string | null } | null;
  taskId: string | null;
  logPages: boolean;
};

function FileChip({ file, label }: { file: FileItem; label?: string }) {
  return (
    <div className="bg-background flex min-w-0 items-center gap-2.5 rounded-lg border p-2">
      <div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
        <FileIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.fileName}</p>
        <p className="text-muted-foreground truncate text-xs">
          {label ? `${label} · ` : ""}v{file.version} · {formatBytes(file.sizeBytes)} · {file.uploadedBy ?? "Someone"} ·{" "}
          {file.when}
        </p>
      </div>
      <Button asChild size="sm" variant="outline">
        <a href={`/papers/files/${file.id}?download=1`}>
          <DownloadIcon /> Download
        </a>
      </Button>
    </div>
  );
}

function Step({
  n,
  title,
  done,
  active,
  last = false,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  active: boolean;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={cn("relative flex gap-3", !last && "pb-5")}>
      {/* line to the next step */}
      {!last && (
        <span
          aria-hidden
          className={cn("absolute top-8 bottom-0 left-[15px] w-0.5", done ? "bg-success" : "bg-border")}
        />
      )}
      <span
        className={cn(
          "relative flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
          done
            ? "bg-success border-success text-white"
            : active
              ? "bg-primary border-primary text-primary-foreground"
              : "bg-background text-muted-foreground",
        )}
      >
        {done ? <CheckIcon className="size-4" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2 pt-1">
        <p className={cn("text-sm font-semibold", !done && !active && "text-muted-foreground")}>{title}</p>
        {children}
      </div>
    </li>
  );
}

/** The reviewers' corrections to fix, newest last. */
function Corrections({ notes }: { notes: NoteItem[] }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <MessageSquareTextIcon className="size-4 text-amber-600" /> {notes.length} correction
        {notes.length === 1 ? "" : "s"} to fix
      </p>
      <ul className="space-y-1.5">
        {notes.map((n) => (
          <li key={n.id} className="text-sm">
            <span className="text-muted-foreground text-xs">
              {n.author}
              {n.stageLabel ? ` · ${n.stageLabel}` : ""} · {n.when}
            </span>
            <p className="whitespace-pre-line">{n.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Your part" on a paper: for each stage the member owns, a clear
 * Get → Do → Finish flow with the files they need and the upload for their own work.
 */
export function MyStagePanel({ paperId, stage: s }: { paperId: string; stage: MyStage }) {
  const hasInput = s.inputs.some((i) => i.file || i.link);
  const myWorkSaved = Boolean(s.myFile || s.myLink || s.myNotes > 0);
  const finished = s.status === "done";
  const needsWork = s.uploadOpen && !myWorkSaved;

  return (
    <SpotlightCard
      className={cn(
        "min-w-0 space-y-4 p-4 sm:p-5",
        finished ? "border-success/40" : "border-primary/40 bg-primary/5",
        s.overdue && !finished && "border-destructive/50 bg-destructive/5",
      )}
    >
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Your part · Stage {s.number}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-lg font-semibold">{s.label}</p>
          {finished ? (
            <Badge variant="success">Done</Badge>
          ) : (
            <Badge variant={s.overdue ? "destructive" : "default"}>{s.overdue ? "Overdue" : "Your turn"}</Badge>
          )}
          {s.workDays && (
            <span
              className={cn(
                "text-xs font-medium",
                s.overdue && !finished ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {s.workDays}
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-sm">{s.howTo}</p>
      </div>

      <ol className="min-w-0">
        {s.inputs.length > 0 && (
          <Step n={1} title="Get the work from the stage before" done={hasInput} active={!hasInput}>
            <div className="grid min-w-0 gap-2">
              {s.inputs.map((input) =>
                input.file || input.link ? (
                  <div key={input.stageLabel} className="min-w-0 space-y-1.5">
                    {input.file && (
                      <FileChip file={input.file} label={`${input.stageLabel} · ${input.ownerName ?? ""}`} />
                    )}
                    {input.link && (
                      <Button asChild size="sm" variant="outline">
                        <a href={input.link} target="_blank" rel="noreferrer">
                          <ExternalLinkIcon /> Open {input.stageLabel} link
                        </a>
                      </Button>
                    )}
                  </div>
                ) : (
                  <p
                    key={input.stageLabel}
                    className="text-muted-foreground rounded-lg border border-dashed p-2.5 text-sm"
                  >
                    {input.stageLabel}
                    {input.ownerName ? ` (${input.ownerName})` : ""}:{" "}
                    {input.done ? "done, but no file was shared – message them below." : "not finished yet."}
                  </p>
                ),
              )}
            </div>
            {s.corrections.length > 0 && <Corrections notes={s.corrections} />}
          </Step>
        )}

        <Step
          n={s.inputs.length > 0 ? 2 : 1}
          title={s.review ? "Write your corrections" : s.uploadOpen ? "Upload your work" : "Your work"}
          done={myWorkSaved}
          active={!myWorkSaved && (!finished || s.uploadOpen)}
        >
          <div className="space-y-2">
            {s.review && (
              <>
                {s.myNotes > 0 && (
                  <p className="text-success flex items-center gap-1.5 text-sm font-medium">
                    <MessageSquareTextIcon className="size-4" /> You sent {s.myNotes} correction
                    {s.myNotes === 1 ? "" : "s"} – see them under Corrections &amp; notes.
                  </p>
                )}
                {!finished && <NoteForm paperId={paperId} fixedStage={s.stage} />}
                <p className="text-muted-foreground text-xs">Or upload the paper with your marks on it:</p>
              </>
            )}
            {s.myFile && <FileChip file={s.myFile} label="Your latest upload" />}
            {s.uploadOpen && (
              <PaperFileUploader
                paperId={paperId}
                defaultStage={s.stage}
                stages={[{ stage: s.stage, label: s.label }]}
                buttonLabel={s.myFile ? "Upload a new version" : s.review ? "Upload marked PDF" : "Upload file"}
              />
            )}
            {!s.review && (
              <div className="flex flex-wrap items-center gap-2">
                {s.myLink && (
                  <Button asChild size="sm" variant="outline">
                    <a href={s.myLink} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon /> Open your link
                    </a>
                  </Button>
                )}
                <StageLinkDialog paperId={paperId} stageId={s.stageId} label={s.label} link={s.myLink} />
              </div>
            )}
            {s.groupLinks && (s.groupLinks.lms || s.groupLinks.physical) && (
              <div className="space-y-1.5 pt-1">
                <p className="text-muted-foreground text-xs">Then share the final PDF in the groups:</p>
                <div className="flex flex-wrap gap-2">
                  {s.groupLinks.lms && (
                    <Button asChild size="sm" className="bg-[#0f7a6e] text-white hover:bg-[#0c675d]">
                      <a href={s.groupLinks.lms} target="_blank" rel="noreferrer">
                        <UsersIcon /> LMS admin group
                      </a>
                    </Button>
                  )}
                  {s.groupLinks.physical && (
                    <Button asChild size="sm" className="bg-[#0f7a6e] text-white hover:bg-[#0c675d]">
                      <a href={s.groupLinks.physical} target="_blank" rel="noreferrer">
                        <UsersIcon /> Physical coordinator group
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </Step>

        <Step
          n={s.inputs.length > 0 ? 3 : 2}
          title={finished ? "Marked as done" : "Mark your stage done"}
          last
          done={finished}
          active={!finished && myWorkSaved}
        >
          {finished ? (
            <p className="text-muted-foreground text-sm">
              The next member has been told. {s.uploadOpen ? "You can still upload a corrected version above." : ""}
            </p>
          ) : s.taskId ? (
            <div className="flex flex-wrap items-center gap-2">
              <FinishStageButton taskId={s.taskId} label={s.label} logPages={s.logPages} needsFile={needsWork} />
              <span className="text-muted-foreground text-xs">The next member gets it straight away.</span>
            </div>
          ) : null}
        </Step>
      </ol>
    </SpotlightCard>
  );
}
