import { CheckIcon, DownloadIcon, ExternalLinkIcon, FileIcon, MessageCircleIcon } from "lucide-react";
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
  /** Reviews and hand over happen on WhatsApp. */
  whatsapp: boolean;
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

/**
 * "Your part" on a paper: for each stage the member owns, a clear
 * Get → Do → Finish flow with the files they need and the upload for their own work.
 */
export function MyStagePanel({ paperId, stage: s }: { paperId: string; stage: MyStage }) {
  const hasInput = s.inputs.some((i) => i.file || i.link);
  const myWorkSaved = Boolean(s.myFile || s.myLink);
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
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Your part · Stage {s.number}</p>
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
                    {input.done ? "done, but no file was shared – ask them on WhatsApp." : "not finished yet."}
                  </p>
                ),
              )}
            </div>
          </Step>
        )}

        <Step
          n={s.inputs.length > 0 ? 2 : 1}
          title={s.whatsapp ? "Do your part on WhatsApp" : s.uploadOpen ? "Upload your work" : "Your work"}
          done={myWorkSaved || (s.whatsapp && finished)}
          active={!myWorkSaved && (!finished || s.uploadOpen)}
        >
          {s.whatsapp ? (
            <p className="text-muted-foreground flex items-start gap-1.5 text-sm">
              <MessageCircleIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              Files aren&apos;t uploaded from this stage. Use the WhatsApp buttons below to talk to the team.
            </p>
          ) : (
            <div className="space-y-2">
              {s.myFile && <FileChip file={s.myFile} label="Your latest upload" />}
              {s.uploadOpen && (
                <PaperFileUploader
                  paperId={paperId}
                  defaultStage={s.stage}
                  stages={[{ stage: s.stage, label: s.label }]}
                  buttonLabel={s.myFile ? "Upload a new version" : "Upload file"}
                />
              )}
              <div className="flex flex-wrap items-center gap-2">
                {s.myLink && (
                  <Button asChild size="sm" variant="outline">
                    <a href={s.myLink} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon /> Open your link
                    </a>
                  </Button>
                )}
                <StageLinkDialog paperId={paperId} stageId={s.stageId} label={s.label} link={s.myLink} />
                {!s.uploadOpen && !s.myFile && (
                  <span className="text-muted-foreground text-xs">
                    Uploads are closed for this stage – share a link.
                  </span>
                )}
              </div>
            </div>
          )}
        </Step>

        <Step
          n={s.inputs.length > 0 ? 3 : 2}
          title={finished ? "Marked as done" : "Mark your stage done"}
          last
          done={finished}
          active={!finished && (myWorkSaved || s.whatsapp)}
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
