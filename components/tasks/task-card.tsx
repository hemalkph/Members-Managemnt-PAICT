"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  CalendarClockIcon,
  CheckIcon,
  FilePlus2Icon,
  FileStackIcon,
  FlameIcon,
  GraduationCapIcon,
  HashIcon,
  HourglassIcon,
  Loader2Icon,
  MapPinIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  UserIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteTaskAction, setTaskStatusAction } from "@/lib/actions/tasks";
import type { TaskView } from "@/lib/task-queries";
import { cn } from "@/lib/utils";

const STATUS_BADGE = {
  waiting: { label: "Up next", variant: "secondary" as const },
  open: { label: "To do", variant: "outline" as const },
  done: { label: "Done", variant: "success" as const },
  cancelled: { label: "Cancelled", variant: "secondary" as const },
};

/** One task. `mode="admin"` adds edit / cancel / delete; members get Log work + Mark done. */
export function TaskCard({
  task,
  mode,
  onEdit,
  whatsapp,
}: {
  task: TaskView;
  mode: "member" | "admin";
  onEdit?: (task: TaskView) => void;
  /** Admins: the member's WhatsApp number (wa.me format), shown when the task is late. */
  whatsapp?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const setStatus = (status: "open" | "done" | "cancelled") =>
    startTransition(async () => {
      const result = await setTaskStatusAction({ id: task.id, status });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteTaskAction({ id: task.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  const badge = STATUS_BADGE[task.status];
  const finished = task.status === "done" || task.status === "cancelled";

  return (
    <SpotlightCard
      className={cn(
        "flex flex-col gap-3 p-4",
        task.overdue && "border-destructive/40 bg-destructive/5",
        finished && "opacity-80",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className={cn("leading-snug font-semibold", task.status === "done" && "line-through decoration-1")}>
            {task.title}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={badge.variant}>
              {task.status === "waiting" && <HourglassIcon />}
              {task.status === "done" && <CheckIcon />}
              {badge.label}
            </Badge>
            {task.priority === "high" && !finished && (
              <Badge variant="destructive">
                <FlameIcon /> High priority
              </Badge>
            )}
            {task.paperId && (
              <Badge variant="outline">
                <FileStackIcon /> Paper stage
              </Badge>
            )}
          </div>
        </div>
        {mode === "admin" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${task.title}`} disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {task.paperId ? (
                <DropdownMenuItem asChild>
                  <Link href={`/papers/${task.paperId}`}>
                    <FileStackIcon /> Open paper
                  </Link>
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem onSelect={() => onEdit?.(task)}>
                    <PencilIcon /> Edit
                  </DropdownMenuItem>
                  {task.status === "open" && (
                    <DropdownMenuItem onSelect={() => setStatus("done")}>
                      <CheckIcon /> Mark done
                    </DropdownMenuItem>
                  )}
                  {finished ? (
                    <DropdownMenuItem onSelect={() => setStatus("open")}>
                      <RotateCcwIcon /> Reopen
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => setStatus("cancelled")}>
                      <XCircleIcon /> Cancel task
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={remove}>
                    <Trash2Icon /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {task.description && <p className="text-muted-foreground line-clamp-3 text-sm">{task.description}</p>}

      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {mode === "admin" && (
          <span className="inline-flex items-center gap-1">
            <UserIcon className="size-3.5" /> {task.assigneeName}
          </span>
        )}
        {task.dueLabel && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              task.overdue && "text-destructive font-semibold",
              task.dueSoon && "font-semibold text-amber-700 dark:text-warning",
            )}
          >
            <CalendarClockIcon className="size-3.5" /> {task.dueLabel}
          </span>
        )}
        {task.examLabel && (
          <span className="inline-flex items-center gap-1">
            <GraduationCapIcon className="size-3.5" /> {task.examLabel}
          </span>
        )}
        {task.centreName && (
          <span className="inline-flex items-center gap-1">
            <MapPinIcon className="size-3.5" /> {task.centreName}
          </span>
        )}
        {task.quantity && (
          <span className="inline-flex items-center gap-1">
            <HashIcon className="size-3.5" /> {task.quantity}
            {task.roleName ? ` · ${task.roleName}` : ""}
          </span>
        )}
        {task.workCount > 0 && <span>{task.workCount} work logged</span>}
      </div>

      {mode === "admin" && task.overdue && whatsapp && (
        <Button asChild size="sm" className="w-fit bg-[#0f7a6e] text-white hover:bg-[#0c675d]">
          <a
            href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(
              `Hi ${task.assigneeName.split(" ")[0]}, "${task.title}" is ${task.dueLabel?.toLowerCase() ?? "overdue"}. Can you finish it today?`,
            )}`}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircleIcon /> WhatsApp {task.assigneeName.split(" ")[0]}
          </a>
        </Button>
      )}

      {mode === "member" && (task.status === "open" || task.status === "done") && (
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {task.paperId ? (
            <Button asChild size="sm" variant="outline" className="flex-1">
              <Link href={`/papers/${task.paperId}`}>
                <FileStackIcon /> Open paper
              </Link>
            </Button>
          ) : (
            task.status === "open" && (
              <Button asChild size="sm" variant="outline" className="flex-1">
                <Link href={`/work/new?task=${task.id}`}>
                  <FilePlus2Icon /> Log work
                </Link>
              </Button>
            )
          )}
          {task.status === "open" ? (
            <Button size="sm" variant="success" className="flex-1" disabled={pending} onClick={() => setStatus("done")}>
              {pending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
              Mark done
            </Button>
          ) : (
            !task.paperId && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setStatus("open")}>
                <RotateCcwIcon /> Undo
              </Button>
            )
          )}
        </div>
      )}
      {mode === "member" && task.status === "waiting" && (
        <p className="text-muted-foreground mt-auto text-xs">Starts when the previous stage of the paper is done.</p>
      )}
    </SpotlightCard>
  );
}
