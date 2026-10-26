import Link from "next/link";
import { CalendarDaysIcon, ChevronRightIcon, LinkIcon, SendIcon, TriangleAlertIcon } from "lucide-react";
import Stepper from "@/components/reactbits/stepper";
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
        "hover:bg-accent/40 grid gap-3 rounded-xl border p-3 transition-colors sm:grid-cols-[minmax(0,1fr)_minmax(0,272px)_auto] sm:items-center sm:p-4",
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
      <Stepper steps={paperSteps(paper.stages, (d) => formatDay(d))} compact />
      <ChevronRightIcon className="text-muted-foreground hidden size-4 sm:block" />
    </Link>
  );
}
