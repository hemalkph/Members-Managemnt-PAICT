import Link from "next/link";
import { ChevronRightIcon, FileIcon, TriangleAlertIcon } from "lucide-react";
import Stepper from "@/components/reactbits/stepper";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { paperSteps, STAGE_LABEL, type PaperView } from "@/lib/papers";
import { cn } from "@/lib/utils";

/** One paper in a list: title, stepper and who has it now. */
export function PaperRow({ paper }: { paper: PaperView }) {
  const current = paper.stages.find((s) => s.status === "in_progress");
  const done = paper.status === "done";
  return (
    <Link
      href={`/papers/${paper.id}`}
      className={cn(
        "hover:bg-accent/40 grid gap-3 rounded-xl border p-3 transition-colors sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)_auto] sm:items-center sm:p-4",
        current?.overdue && "border-destructive/40",
        paper.status === "cancelled" && "opacity-60",
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate font-medium">{paper.title}</p>
          <Badge variant="outline" className="capitalize">
            {paper.kind}
          </Badge>
          {done && <Badge variant="success">Done</Badge>}
          {paper.status === "cancelled" && <Badge variant="secondary">Cancelled</Badge>}
        </div>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
          {current ? (
            <span className={cn(current.overdue && "text-destructive font-semibold")}>
              {current.overdue && <TriangleAlertIcon className="mr-0.5 inline size-3" />}
              {STAGE_LABEL[current.stage]}: {current.ownerName ?? "no owner yet"}
              {current.dueDate && ` · due ${formatDate(current.dueDate)}`}
            </span>
          ) : done ? (
            <span>Finished {paper.completedAt ? formatDate(paper.completedAt) : ""}</span>
          ) : null}
          {paper.fileCount > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <FileIcon className="size-3" /> {paper.fileCount}
            </span>
          )}
        </p>
      </div>
      <Stepper steps={paperSteps(paper.stages, (d) => formatDate(d))} compact />
      <ChevronRightIcon className="text-muted-foreground hidden size-4 sm:block" />
    </Link>
  );
}
