"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CalendarClockIcon,
  CheckIcon,
  FilePlus2Icon,
  FileStackIcon,
  FlameIcon,
  GraduationCapIcon,
  HashIcon,
  HourglassIcon,
  ListTodoIcon,
  Loader2Icon,
  MapPinIcon,
  MessageSquareWarningIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  Undo2Icon,
  UserIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { deleteTaskAction, sendTaskBackAction, setTaskStatusAction } from "@/lib/actions/tasks";
import type { TaskView } from "@/lib/tasks/queries";
import { getSiteUrl } from "@/lib/core/env";
import { taskWhatsAppText, whatsAppLink } from "@/lib/tasks/whatsapp";
import { cn } from "@/lib/utils";
import { TaskDetails } from "./task-details";
import { TaskTypeIcon } from "./task-type-icon";
import { TaskFilesButton } from "./task-files";

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
  readOnly = false,
}: {
  task: TaskView;
  mode: "member" | "admin";
  onEdit?: (task: TaskView) => void;
  /** Admin view with read-only page access: no edit / cancel / delete. */
  readOnly?: boolean;
  /** Admins: the member's WhatsApp number (wa.me format), for the WhatsApp button on open tasks. */
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

  const [sendBack, setSendBack] = useState(false);
  const [note, setNote] = useState("");

  const submitSendBack = () =>
    startTransition(async () => {
      const result = await sendTaskBackAction({ id: task.id, note });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setSendBack(false);
      setNote("");
      router.refresh();
    });

  const badge = STATUS_BADGE[task.status];
  const finished = task.status === "done" || task.status === "cancelled";
  const paper = Boolean(task.paperId);
  // Paper stage titles are "Stage: Paper name"; show the stage as the label.
  const cut = paper ? task.title.indexOf(": ") : -1;
  const kindLabel = paper ? `Paper stage${cut > 0 ? ` · ${task.title.slice(0, cut)}` : ""}` : (task.typeName ?? "Task");
  const heading = cut > 0 ? task.title.slice(cut + 2) : task.title;
  const sentBack = task.status === "open" && Boolean(task.fixNote);
  const fixedAgain = task.status === "done" && Boolean(task.sentBackAt);

  return (
    <SpotlightCard
      className={cn(
        "flex flex-col gap-3 p-4",
        paper && "bg-chart-2/[0.04]",
        task.overdue && "border-destructive/40 bg-destructive/5",
        finished && "opacity-80",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-2">
          <div className="flex items-start gap-2.5">
            {paper ? (
              <span className="bg-chart-2/15 text-chart-2 flex size-9 shrink-0 items-center justify-center rounded-lg">
                <FileStackIcon className="size-4" />
              </span>
            ) : task.typeName ? (
              <TaskTypeIcon icon={task.typeIcon} color={task.typeColor} size={16} className="size-9 shrink-0 rounded-lg" />
            ) : (
              <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <ListTodoIcon className="size-4" />
              </span>
            )}
            <div className="min-w-0">
              <p
                className={cn(
                  "truncate text-[11px] font-semibold tracking-wide uppercase",
                  paper ? "text-chart-2" : "text-muted-foreground",
                )}
              >
                {kindLabel}
              </p>
              <p
                className={cn(
                  "leading-snug font-semibold break-words",
                  task.status === "done" && "line-through decoration-1",
                )}
              >
                {heading}
              </p>
            </div>
          </div>
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
            {sentBack && (
              <Badge variant="destructive">
                <Undo2Icon /> Sent back to fix
              </Badge>
            )}
            {fixedAgain && (
              <Badge variant="warning">
                <RotateCcwIcon /> Fixed – check again
              </Badge>
            )}
          </div>
        </div>
        {mode === "admin" && readOnly && task.paperId && (
          <Button asChild variant="ghost" size="icon" aria-label={`Open the paper for ${task.title}`}>
            <Link href={`/papers/${task.paperId}`}>
              <FileStackIcon />
            </Link>
          </Button>
        )}
        {mode === "admin" && !readOnly && (
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
                  {task.status === "done" && (
                    <DropdownMenuItem onSelect={() => setSendBack(true)}>
                      <Undo2Icon /> Send back to fix
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

      {sentBack && (
        <div className="border-destructive/40 bg-destructive/5 flex gap-2 rounded-lg border p-3 text-sm">
          <MessageSquareWarningIcon className="text-destructive mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">{mode === "member" ? "Please fix this and send it again" : "Waiting for the fix"}</p>
            <p className="text-muted-foreground break-words whitespace-pre-line">{task.fixNote}</p>
            {mode === "member" && !paper && (
              <p className="text-muted-foreground mt-1.5 text-xs">
                Remove the wrong file in Files, upload the right one, then press Mark done.
              </p>
            )}
          </div>
        </div>
      )}

      {task.typeInstructions && !finished && (
        <p className="text-muted-foreground text-xs whitespace-pre-line">{task.typeInstructions}</p>
      )}

      <TaskDetails details={task.details} files={task.files} />

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

      <TaskFilesButton task={task} mode={mode} readOnly={readOnly} />

      {mode === "admin" && task.status === "open" && whatsapp && (
        <Button
          asChild
          size="sm"
          variant={task.overdue ? "default" : "outline"}
          className={cn("w-fit", task.overdue && "bg-[#0f7a6e] text-white hover:bg-[#0c675d]")}
        >
          <a
            href={whatsAppLink(whatsapp, taskWhatsAppText(task, getSiteUrl()))}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircleIcon /> {task.overdue ? "Remind" : "WhatsApp"} {task.assigneeName.split(" ")[0]}
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
      {mode === "admin" && (
        <Dialog open={sendBack} onOpenChange={setSendBack}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send back to fix</DialogTitle>
              <DialogDescription>
                {task.assigneeName.split(" ")[0]} gets a notification with your note. The task opens again until they fix
                it and mark it done.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`fix-${task.id}`}>What needs fixing?</Label>
              <Textarea
                id={`fix-${task.id}`}
                rows={4}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Wrong image size. Please upload a 1080 × 1080 version."
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSendBack(false)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={pending || !note.trim()} onClick={submitSendBack}>
                {pending ? <Loader2Icon className="animate-spin" /> : <Undo2Icon />} Send back
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </SpotlightCard>
  );
}
