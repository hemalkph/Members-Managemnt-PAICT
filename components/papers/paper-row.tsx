import Link from "next/link";
import { CalendarDaysIcon, ChevronRightIcon, LinkIcon, SendIcon, TriangleAlertIcon } from "lucide-react";
import type { StepState } from "@/components/reactbits/stepper";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDay } from "@/lib/format";
import { MEDIUM_LABEL, PART_LABEL, paperSteps, STAGE_LABEL, type PaperView } from "@/lib/papers";
import { cn } from "@/lib/utils";

/** One paper in a list: title, stepper and who has it now. */
export function PaperRow({ paper }: { paper: PaperView }) {
  const current = paper.stages.filter((s) => s.status === "in_progress");
  const late = current.some((s) => s.overdue);
  const done = paper.status === "done";
  return (
    <Link
      href={`/papers/${paper.id}`}
      className={cn(
        "hover:bg-accent/40 grid gap-3 rounded-xl border p-3 transition-colors sm:grid-cols-[minmax(0,1fr)_minmax(180px,260px)_auto] sm:items-center sm:gap-4 sm:p-4",
        late && "border-destructive/40",
        paper.status === "cancelled" && "opacity-60",
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate font-medium">{paper.title}</p>
          {paper.kind === "tute" ? (
            <Badge variant="outline">Tute</Badge>
          ) : (
            <Badge variant="outline">{PART_LABEL[paper.part]}</Badge>
          )}
          <Badge variant="secondary">{MEDIUM_LABEL[paper.medium]}</Badge>
          {done && <Badge variant="success">Done</Badge>}
          {paper.status === "cancelled" && <Badge variant="secondary">Cancelled</Badge>}
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {paper.examDay && (
            <span className="inline-flex items-center gap-1">
              <CalendarDaysIcon className="size-3" /> {formatDay(paper.examDay)}
            </span>
          )}
          {current.map((s) => (
            <span key={s.id} className={cn(s.overdue && "text-destructive font-semibold")}>
              {s.overdue && <TriangleAlertIcon className="mr-0.5 inline size-3" />}
              {STAGE_LABEL[s.stage]}: {s.ownerName ?? "no owner yet"}
              {s.dueDate && ` · due ${formatDay(s.dueDate)}`}
            </span>
          ))}
          {done && <span>Finished {paper.completedAt ? formatDate(paper.completedAt) : ""}</span>}
          {paper.handedOverAt && (
            <span className="text-success inline-flex items-center gap-1">
              <SendIcon className="size-3" /> Handed over
            </span>
          )}
          {paper.linkCount > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <LinkIcon className="size-3" /> {paper.linkCount}
            </span>
          )}
        </div>
      </div>
      <StageProgress paper={paper} />
      <ChevronRightIcon className="text-muted-foreground hidden size-4 sm:block" />
    </Link>
  );
}

const SEGMENT: Record<StepState, string> = {
  done: "bg-success",
  active: "bg-primary",
  overdue: "bg-destructive",
  waiting: "bg-muted-foreground/20",
  skipped: "bg-muted-foreground/10",
};

/**
 * Progress as one thin bar per stage (always fits the row, however many
 * stages), with the current stage named above it.
 */
function StageProgress({ paper }: { paper: PaperView }) {
  const steps = paperSteps(paper.stages, (d) => formatDay(d));
  const finished = steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  const currentIndex = steps.findIndex((s) => s.state === "active" || s.state === "overdue");
  const current = currentIndex >= 0 ? steps[currentIndex] : null;
  const others = current ? steps.filter((s, i) => i !== currentIndex && (s.state === "active" || s.state === "overdue")).length : 0;

  const label =
    paper.status === "cancelled"
      ? "Cancelled"
      : current
        ? `Stage ${currentIndex + 1} of ${steps.length} · ${current.label}${others > 0 ? ` +${others}` : ""}`
        : finished === steps.length
          ? "All stages done"
          : `${finished} of ${steps.length} stages done`;

  return (
    <div className="min-w-0 space-y-1.5" aria-label={steps.map((s) => `${s.label}: ${s.state}`).join(", ")}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={cn("truncate font-medium", current?.state === "overdue" && "text-destructive")}>{label}</span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {finished}/{steps.length}
        </span>
      </div>
      <div className="flex gap-0.5">
        {steps.map((s, i) => (
          <span
            key={s.key}
            title={`${i + 1}. ${s.label}${s.hint ? ` – ${s.hint}` : ""}`}
            className={cn(
              "h-1.5 min-w-0 flex-1 rounded-full",
              SEGMENT[s.state],
              (s.state === "active" || s.state === "overdue") && "h-2 -translate-y-px",
            )}
          />
        ))}
      </div>
    </div>
  );
}
