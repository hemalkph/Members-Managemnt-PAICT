"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  BriefcaseIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  FilePlus2Icon,
  FileStackIcon,
  FlameIcon,
  GraduationCapIcon,
  HashIcon,
  HourglassIcon,
  ListTodoIcon,
  Loader2Icon,
  MapPinIcon,
  MessageCircleIcon,
  MessageSquareWarningIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { deleteTaskAction, sendTaskBackAction, setTaskStatusAction } from "@/lib/actions/tasks";
import { getSiteUrl } from "@/lib/core/env";
import { formatBytes, formatDate, initials } from "@/lib/core/format";
import type { TaskView } from "@/lib/tasks/queries";
import type { TaskColor } from "@/lib/tasks/types";
import { taskWhatsAppText, whatsAppLink } from "@/lib/tasks/whatsapp";
import { cn } from "@/lib/utils";
import { TaskDetails } from "./task-details";
import { TaskFilesButton } from "./task-files";
import { TaskTypeIcon } from "./task-type-icon";

/** Soft pill classes matching each TaskType colour so variations pop instantly. */
const TYPE_PILL_CLASSES: Record<TaskColor, string> = {
  blue: "bg-blue-500/12 text-blue-700 border-blue-500/20 dark:bg-blue-400/15 dark:text-blue-300 dark:border-blue-400/25",
  sky: "bg-sky-500/12 text-sky-700 border-sky-500/20 dark:bg-sky-400/15 dark:text-sky-300 dark:border-sky-400/25",
  emerald: "bg-emerald-500/12 text-emerald-700 border-emerald-500/20 dark:bg-emerald-400/15 dark:text-emerald-300 dark:border-emerald-400/25",
  violet: "bg-violet-500/12 text-violet-700 border-violet-500/20 dark:bg-violet-400/15 dark:text-violet-300 dark:border-violet-400/25",
  rose: "bg-rose-500/12 text-rose-700 border-rose-500/20 dark:bg-rose-400/15 dark:text-rose-300 dark:border-rose-400/25",
  amber: "bg-amber-500/15 text-amber-700 border-amber-500/25 dark:bg-amber-400/15 dark:text-amber-300 dark:border-amber-400/25",
  indigo: "bg-indigo-500/12 text-indigo-700 border-indigo-500/20 dark:bg-indigo-400/15 dark:text-indigo-300 dark:border-indigo-400/25",
  teal: "bg-teal-500/12 text-teal-700 border-teal-500/20 dark:bg-teal-400/15 dark:text-teal-300 dark:border-teal-400/25",
  orange: "bg-orange-500/12 text-orange-700 border-orange-500/20 dark:bg-orange-400/15 dark:text-orange-300 dark:border-orange-400/25",
  purple: "bg-purple-500/12 text-purple-700 border-purple-500/20 dark:bg-purple-400/15 dark:text-purple-300 dark:border-purple-400/25",
  slate: "bg-slate-500/12 text-slate-700 border-slate-500/20 dark:bg-slate-400/15 dark:text-slate-300 dark:border-slate-400/25",
};

/**
 * Full-width expandable horizontal task row inspired by the clean reference UI (Images 1 & 2).
 * - Collapsed: task variation icon tile, title, type/stage pill, assignee avatar, role badge,
 *   due/overdue pill, semantic status pill, circular quick-action icons, and expand chevron.
 * - Expanded: structured metadata grid, fix-note banner, full description/instructions,
 *   custom TaskDetails fields with copy buttons, and files/action bar.
 */
export function TaskRow({
  task,
  mode,
  onEdit,
  whatsapp,
  readOnly = false,
  defaultOpen = false,
}: {
  task: TaskView;
  mode: "member" | "admin";
  onEdit?: (task: TaskView) => void;
  readOnly?: boolean;
  whatsapp?: string | null;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(defaultOpen);
  const [pending, startTransition] = useTransition();
  const [sendBack, setSendBack] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState("");

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
      setConfirmDelete(false);
      toast.success(result.message);
      router.refresh();
    });

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

  const paper = Boolean(task.paperId);
  const cut = paper ? task.title.indexOf(": ") : -1;
  const stageLabel = paper && cut > 0 ? task.title.slice(0, cut) : null;
  const heading = cut > 0 ? task.title.slice(cut + 2) : task.title;
  const kindLabel = paper ? (stageLabel ? `Paper · ${stageLabel}` : "Paper stage") : (task.typeName ?? "General task");

  const isOpen = task.status === "open";
  const isWaiting = task.status === "waiting";
  const isDone = task.status === "done";
  const isCancelled = task.status === "cancelled";
  const finished = isDone || isCancelled;
  const sentBack = isOpen && Boolean(task.fixNote);
  const fixedAgain = isDone && Boolean(task.sentBackAt);

  const incoming = mode === "member" ? "brief" : "work";
  const newFilesCount = task.files.filter((f) => f.kind === incoming && !f.seen).length;
  const firstName = task.assigneeName.split(" ")[0];
  const waHref = whatsapp ? whatsAppLink(whatsapp, taskWhatsAppText(task, getSiteUrl())) : null;

  // High-contrast status pill (modeled after Image 1 Active/Inactive pills)
  const statusPill = (() => {
    if (isCancelled) {
      return {
        label: "Cancelled",
        icon: XCircleIcon,
        className:
          "bg-rose-500/12 text-rose-700 border-rose-500/25 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30",
      };
    }
    if (isDone) {
      if (fixedAgain) {
        return {
          label: "Check fix",
          icon: RotateCcwIcon,
          className:
            "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:bg-warning/20 dark:text-warning dark:border-warning/30",
        };
      }
      return {
        label: "Done",
        icon: CheckCircle2Icon,
        className:
          "bg-emerald-500/15 text-emerald-700 border-emerald-500/25 dark:bg-success/20 dark:text-success dark:border-success/30",
      };
    }
    if (isWaiting) {
      return {
        label: "Up next",
        icon: HourglassIcon,
        className:
          "bg-slate-500/12 text-slate-700 border-slate-500/25 dark:bg-slate-400/15 dark:text-slate-300 dark:border-slate-400/25",
      };
    }
    if (task.overdue) {
      return {
        label: "Overdue",
        icon: TriangleAlertIcon,
        className:
          "bg-destructive text-white border-transparent shadow-xs dark:bg-destructive/90",
      };
    }
    if (sentBack) {
      return {
        label: "Needs fix",
        icon: Undo2Icon,
        className:
          "bg-destructive/15 text-destructive border-destructive/30 dark:bg-destructive/25",
      };
    }
    return {
      label: "Open",
      icon: CheckCircle2Icon,
      className:
        "bg-primary text-primary-foreground border-transparent shadow-xs",
    };
  })();

  const StatusIcon = statusPill.icon;

  return (
    <>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div
          className={cn(
            "bg-card text-card-foreground group relative overflow-hidden rounded-xl border shadow-xs transition-all duration-150",
            "hover:border-foreground/20 hover:shadow-sm",
            expanded && "border-primary/35 shadow-sm",
            task.overdue && isOpen && "border-destructive/40 bg-destructive/[0.025] dark:bg-destructive/[0.04]",
            sentBack && !task.overdue && "border-destructive/35",
            isCancelled && "bg-card/70 opacity-85 hover:opacity-100",
          )}
        >
          {/* Main collapsed row */}
          <div className="flex flex-col gap-2.5 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            {/* Left cluster: clickable area to expand/collapse */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-lg"
            >
              {/* Variation Icon Tile */}
              {paper ? (
                <span className="bg-chart-2/12 text-chart-2 border-chart-2/20 mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border">
                  <FileStackIcon className="size-4" />
                </span>
              ) : task.typeName ? (
                <TaskTypeIcon
                  icon={task.typeIcon}
                  color={task.typeColor}
                  size={16}
                  className="mt-0.5 size-9 shrink-0 rounded-lg border border-current/15"
                />
              ) : (
                <span className="bg-primary/10 text-primary border-primary/15 mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border">
                  <ListTodoIcon className="size-4" />
                </span>
              )}

              {/* Title + Variation Badges + Scannable Metadata Row */}
              <div className="min-w-0 flex-1 space-y-1">
                {/* Line 1: Heading + Priority / Revision flags */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={cn(
                      "text-sm leading-snug font-semibold break-words",
                      isDone && "text-foreground/85",
                      isCancelled && "text-muted-foreground line-through decoration-1",
                    )}
                  >
                    {heading}
                  </span>

                  {task.priority === "high" && !finished && (
                    <Badge variant="destructive" className="h-5 gap-1 rounded-full px-2 text-[11px]">
                      <FlameIcon className="size-3" /> High
                    </Badge>
                  )}

                  {sentBack && (
                    <Badge variant="destructive" className="h-5 gap-1 rounded-full px-2 text-[11px]">
                      <Undo2Icon className="size-3" /> Sent back
                    </Badge>
                  )}

                  {newFilesCount > 0 && (
                    <Badge variant="warning" className="h-5 gap-1 rounded-full px-2 text-[11px]">
                      <PaperclipIcon className="size-3" /> {newFilesCount} new
                    </Badge>
                  )}
                </div>

                {/* Line 2: Category pill + Assignee + Role + Due/Overdue + Exam/Centre/Files */}
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
                  {/* Variation / Task Type Pill (like "Model Paper" amber pill in Image 1) */}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                      paper
                        ? "border-chart-2/25 bg-chart-2/12 text-chart-2"
                        : task.typeName
                          ? TYPE_PILL_CLASSES[task.typeColor]
                          : "border-border bg-muted/60 text-muted-foreground",
                    )}
                  >
                    {kindLabel}
                  </span>

                  {/* Assignee with mini Avatar (Admin mode) */}
                  {mode === "admin" && (
                    <span className="text-foreground/85 inline-flex items-center gap-1.5 font-medium">
                      <Avatar className="size-4.5 border border-border/70">
                        <AvatarFallback className="text-[9px] font-semibold">
                          {initials(task.assigneeName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="max-w-[140px] truncate">{task.assigneeName}</span>
                    </span>
                  )}

                  {/* Role Badge — ALWAYS shown whenever roleName exists */}
                  {task.roleName && (
                    <span className="bg-secondary/80 text-secondary-foreground border-border/60 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium">
                      <BriefcaseIcon className="text-muted-foreground size-3" />
                      {task.roleName}
                    </span>
                  )}

                  {/* Due / Overdue / Completed Date */}
                  {isDone && task.completedLabel ? (
                    <span className="text-success inline-flex items-center gap-1 font-medium">
                      <CheckIcon className="size-3.5" />
                      Done {task.completedLabel}
                    </span>
                  ) : task.dueLabel ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        task.overdue && isOpen
                          ? "bg-destructive/12 text-destructive rounded-md px-1.5 py-0.5 font-semibold"
                          : task.dueSoon && isOpen
                            ? "bg-amber-500/15 text-amber-700 dark:text-warning rounded-md px-1.5 py-0.5 font-semibold"
                            : "text-muted-foreground",
                      )}
                    >
                      {task.overdue && isOpen ? (
                        <TriangleAlertIcon className="size-3.5" />
                      ) : (
                        <CalendarClockIcon className="size-3.5" />
                      )}
                      {task.dueLabel}
                    </span>
                  ) : null}

                  {/* Exam */}
                  {task.examLabel && (
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <GraduationCapIcon className="size-3.5 shrink-0" />
                      <span className="max-w-[170px] truncate">{task.examLabel}</span>
                    </span>
                  )}

                  {/* Centre */}
                  {task.centreName && (
                    <span className="text-muted-foreground hidden items-center gap-1 md:inline-flex">
                      <MapPinIcon className="size-3.5 shrink-0" />
                      {task.centreName}
                    </span>
                  )}

                  {/* Quantity */}
                  {task.quantity && (
                    <span className="text-muted-foreground hidden items-center gap-0.5 tabular-nums md:inline-flex">
                      <HashIcon className="size-3" />
                      {task.quantity}
                    </span>
                  )}

                  {/* Files count (subtle when none new) */}
                  {!paper && task.files.length > 0 && newFilesCount === 0 && (
                    <span className="text-muted-foreground hidden items-center gap-1 sm:inline-flex">
                      <PaperclipIcon className="size-3" />
                      {task.files.length}
                    </span>
                  )}

                  {/* Work logged */}
                  {task.workCount > 0 && (
                    <span className="text-muted-foreground hidden items-center gap-1 lg:inline-flex">
                      · {task.workCount} logged
                    </span>
                  )}
                </div>
              </div>
            </button>

            {/* Right cluster: Status Pill + Inline Circular Quick Actions + Expand Chevron */}
            <div className="flex shrink-0 items-center justify-between gap-2 pl-13 sm:justify-end sm:pl-0">
              {/* High-contrast Status Pill */}
              <span
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold whitespace-nowrap",
                  statusPill.className,
                )}
              >
                <StatusIcon className="size-3" />
                {statusPill.label}
              </span>

              {/* Action Buttons Row */}
              <div className="flex items-center gap-0.5">
                {/* ADMIN ACTIONS */}
                {mode === "admin" && !readOnly && (
                  <>
                    {/* Paper stage: direct Open Paper button */}
                    {paper ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            asChild
                            size="icon-sm"
                            variant="ghost"
                            className="text-chart-2 hover:bg-chart-2/12 hover:text-chart-2 rounded-full"
                            aria-label={`Open paper for ${heading}`}
                          >
                            <Link href={`/papers/${task.paperId}`}>
                              <ExternalLinkIcon className="size-4" />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Open paper</TooltipContent>
                      </Tooltip>
                    ) : (
                      <>
                        {/* OPEN: Mark Done */}
                        {isOpen && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                disabled={pending}
                                onClick={() => setStatus("done")}
                                aria-label={`Mark ${heading} done`}
                                className="text-muted-foreground hover:bg-success/15 hover:text-success rounded-full"
                              >
                                {pending ? <Loader2Icon className="size-4 animate-spin" /> : <CheckCircle2Icon className="size-4" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Mark done</TooltipContent>
                          </Tooltip>
                        )}

                        {/* DONE: Send back to fix + Reopen */}
                        {isDone && (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={pending}
                                  onClick={() => setSendBack(true)}
                                  aria-label={`Send ${heading} back to fix`}
                                  className="text-muted-foreground hover:bg-amber-500/15 hover:text-amber-700 dark:hover:text-warning rounded-full"
                                >
                                  <Undo2Icon className="size-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Send back to fix</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={pending}
                                  onClick={() => setStatus("open")}
                                  aria-label={`Reopen ${heading}`}
                                  className="text-muted-foreground hover:bg-primary/12 hover:text-primary rounded-full"
                                >
                                  <RotateCcwIcon className="size-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Reopen task</TooltipContent>
                            </Tooltip>
                          </>
                        )}

                        {/* CANCELLED: Restore / Reopen */}
                        {isCancelled && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                disabled={pending}
                                onClick={() => setStatus("open")}
                                aria-label={`Restore ${heading} to open`}
                                className="text-primary hover:bg-primary/12 rounded-full"
                              >
                                {pending ? <Loader2Icon className="size-4 animate-spin" /> : <RotateCcwIcon className="size-4" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Restore to Open</TooltipContent>
                          </Tooltip>
                        )}
                      </>
                    )}

                    {/* WhatsApp / Remind button on Open tasks */}
                    {isOpen && waHref && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            asChild
                            size="icon-sm"
                            variant="ghost"
                            className={cn(
                              "rounded-full",
                              task.overdue
                                ? "bg-[#0f7a6e]/15 text-[#0f7a6e] hover:bg-[#0f7a6e]/25 dark:text-emerald-300"
                                : "text-muted-foreground hover:bg-emerald-500/12 hover:text-emerald-600 dark:hover:text-emerald-300",
                            )}
                            aria-label={`${task.overdue ? "Remind" : "WhatsApp"} ${firstName}`}
                          >
                            <a href={waHref} target="_blank" rel="noreferrer">
                              <MessageCircleIcon className="size-4" />
                            </a>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {task.overdue ? `Remind ${firstName} on WhatsApp` : `WhatsApp ${firstName}`}
                        </TooltipContent>
                      </Tooltip>
                    )}

                    {/* Files circular icon button */}
                    {!paper && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <TaskFilesButton task={task} mode="admin" readOnly={readOnly} variant="icon" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {task.files.length > 0
                            ? `Files (${task.files.length}${newFilesCount > 0 ? ` · ${newFilesCount} new` : ""})`
                            : "Add files"}
                        </TooltipContent>
                      </Tooltip>
                    )}

                    {/* Edit button (non-paper) */}
                    {!paper && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => onEdit?.(task)}
                            aria-label={`Edit ${heading}`}
                            className="text-muted-foreground hover:text-foreground rounded-full"
                          >
                            <PencilIcon className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit task</TooltipContent>
                      </Tooltip>
                    )}

                    {/* Overflow menu for Cancel / Delete (non-paper) */}
                    {!paper && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            disabled={pending}
                            aria-label={`More actions for ${heading}`}
                            className="text-muted-foreground hover:text-foreground rounded-full"
                          >
                            <MoreHorizontalIcon className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onSelect={() => onEdit?.(task)}>
                            <PencilIcon /> Edit details
                          </DropdownMenuItem>
                          {isOpen && (
                            <DropdownMenuItem onSelect={() => setStatus("done")}>
                              <CheckIcon /> Mark done
                            </DropdownMenuItem>
                          )}
                          {isDone && (
                            <DropdownMenuItem onSelect={() => setSendBack(true)}>
                              <Undo2Icon /> Send back to fix
                            </DropdownMenuItem>
                          )}
                          {finished ? (
                            <DropdownMenuItem onSelect={() => setStatus("open")}>
                              <RotateCcwIcon /> Restore to Open
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => setStatus("cancelled")}>
                              <XCircleIcon /> Cancel task
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                            <Trash2Icon /> Delete permanently
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </>
                )}

                {/* ADMIN READ-ONLY */}
                {mode === "admin" && readOnly && (
                  <>
                    {paper && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild size="icon-sm" variant="ghost" className="rounded-full" aria-label={`Open paper for ${heading}`}>
                            <Link href={`/papers/${task.paperId}`}>
                              <ExternalLinkIcon className="size-4" />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Open paper</TooltipContent>
                      </Tooltip>
                    )}
                    {!paper && task.files.length > 0 && (
                      <TaskFilesButton task={task} mode="admin" readOnly variant="icon" />
                    )}
                  </>
                )}

                {/* MEMBER ACTIONS */}
                {mode === "member" && (
                  <>
                    {!paper && (
                      <TaskFilesButton task={task} mode="member" variant="icon" />
                    )}
                    {paper && (isOpen || isDone) && (
                      <Button asChild size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs">
                        <Link href={`/papers/${task.paperId}`}>
                          <FileStackIcon className="size-3.5" /> Paper
                        </Link>
                      </Button>
                    )}
                    {!paper && isOpen && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            asChild
                            size="icon-sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-full"
                            aria-label={`Log work for ${heading}`}
                          >
                            <Link href={`/work/new?task=${task.id}`}>
                              <FilePlus2Icon className="size-4" />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Log work</TooltipContent>
                      </Tooltip>
                    )}
                    {isOpen && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            variant="success"
                            disabled={pending}
                            onClick={() => setStatus("done")}
                            className="h-7 rounded-full px-2.5 text-xs"
                          >
                            {pending ? <Loader2Icon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
                            Done
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Mark task done</TooltipContent>
                      </Tooltip>
                    )}
                    {isDone && !paper && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => setStatus("open")}
                            aria-label={`Undo completion for ${heading}`}
                            className="text-muted-foreground hover:text-foreground rounded-full"
                          >
                            <RotateCcwIcon className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Move back to To do</TooltipContent>
                      </Tooltip>
                    )}
                  </>
                )}

                {/* Expand / Collapse Chevron (exact Image 2 trigger) */}
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={expanded ? `Collapse details for ${heading}` : `Expand details for ${heading}`}
                    className="text-muted-foreground hover:text-foreground rounded-full"
                  >
                    <ChevronDownIcon
                      className={cn("size-4 transition-transform duration-200", expanded && "rotate-180")}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
          </div>

          {/* Expandable Inline Drawer (Image 2 pattern) */}
          <CollapsibleContent className="border-t bg-muted/20 dark:bg-muted/10">
            <div className="space-y-4 px-4 py-4 sm:px-5">
              {/* Fix Note Banner */}
              {sentBack && (
                <div className="border-destructive/40 bg-destructive/8 flex gap-2.5 rounded-lg border p-3 text-sm">
                  <MessageSquareWarningIcon className="text-destructive mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-semibold">
                      {mode === "member" ? "Please fix this and send it again" : "Sent back — waiting for fix"}
                    </p>
                    <p className="text-muted-foreground break-words whitespace-pre-line">{task.fixNote}</p>
                    {mode === "member" && !paper && (
                      <p className="text-muted-foreground pt-1 text-xs">
                        Remove the old file in Files, upload the updated one, then click Done.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Waiting paper stage hint */}
              {isWaiting && (
                <div className="bg-muted/60 text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
                  <HourglassIcon className="size-3.5 shrink-0" />
                  <span>Starts automatically once the previous stage of this paper is completed.</span>
                </div>
              )}

              {/* Clean Uppercase Label / Value Metadata Grid (Image 2 style) */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
                <MetaCell label="Assigned to" value={task.assigneeName} />
                {task.roleName && <MetaCell label="Role" value={task.roleName} />}
                <MetaCell
                  label="Due date"
                  value={task.dueDate ? `${formatDate(task.dueDate)}${task.dueLabel ? ` (${task.dueLabel})` : ""}` : "No due date"}
                  tone={task.overdue && isOpen ? "destructive" : task.dueSoon && isOpen ? "warning" : undefined}
                />
                {task.examLabel && <MetaCell label="Exam / Batch" value={task.examLabel} />}
                {task.centreName && <MetaCell label="Centre" value={task.centreName} />}
                {task.quantity && <MetaCell label="Quantity" value={String(task.quantity)} />}
                {task.workCount > 0 && <MetaCell label="Work logged" value={`${task.workCount} submission${task.workCount === 1 ? "" : "s"}`} />}
                {task.createdByName && <MetaCell label="Assigned by" value={task.createdByName} />}
                {task.createdAtLabel && <MetaCell label="Assigned on" value={task.createdAtLabel} />}
                {task.completedLabel && <MetaCell label="Completed on" value={task.completedLabel} tone="success" />}
              </div>

              {/* Description & Type Instructions */}
              {(task.description || (task.typeInstructions && !finished)) && (
                <>
                  <Separator />
                  <div className="grid gap-3 md:grid-cols-2">
                    {task.description && (
                      <div className="space-y-1">
                        <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                          Notes / Description
                        </p>
                        <p className="text-foreground/90 text-sm leading-relaxed break-words whitespace-pre-line">
                          {task.description}
                        </p>
                      </div>
                    )}
                    {task.typeInstructions && !finished && (
                      <div className="space-y-1">
                        <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                          Standard instructions
                        </p>
                        <p className="text-muted-foreground text-sm leading-relaxed break-words whitespace-pre-line">
                          {task.typeInstructions}
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Custom Task Type Fields (TaskDetails) */}
              {task.details.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                      Task details
                    </p>
                    <TaskDetails details={task.details} files={task.files} />
                  </div>
                </>
              )}

              {/* Inline Files Preview + Contextual Footer Actions */}
              {(!paper && task.files.length > 0) ||
              (!paper && !readOnly) ||
              (mode === "admin" && isOpen && waHref) ||
              paper ||
              (mode === "member" && isOpen) ? (
                <>
                  <Separator />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    {/* Quick file preview chips */}
                    <div className="flex flex-wrap items-center gap-2">
                      {!paper &&
                        task.files.slice(0, 3).map((f) => {
                          const isNewFile = f.kind === incoming && !f.seen;
                          return (
                            <a
                              key={f.id}
                              href={`/tasks/files/${f.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className={cn(
                                "bg-background hover:bg-accent/60 inline-flex max-w-[230px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors",
                                isNewFile && "border-amber-500/40 bg-amber-500/5",
                              )}
                            >
                              <FileIcon className="text-primary size-3.5 shrink-0" />
                              <span className="truncate font-medium">{f.fileName}</span>
                              <span className="text-muted-foreground shrink-0 text-[10px]">{formatBytes(f.sizeBytes)}</span>
                              {isNewFile && (
                                <Badge variant="warning" className="h-4 px-1 text-[10px]">
                                  New
                                </Badge>
                              )}
                              <DownloadIcon className="text-muted-foreground size-3 shrink-0" />
                            </a>
                          );
                        })}
                      {!paper && task.files.length > 3 && (
                        <span className="text-muted-foreground text-xs">+{task.files.length - 3} more</span>
                      )}
                      {!paper && (
                        <TaskFilesButton task={task} mode={mode} readOnly={readOnly} variant="pill" />
                      )}
                    </div>

                    {/* Right Footer Quick Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                      {paper && (
                        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                          <Link href={`/papers/${task.paperId}`}>
                            <FileStackIcon className="size-3.5" /> Open paper
                          </Link>
                        </Button>
                      )}
                      {mode === "admin" && isOpen && waHref && (
                        <Button
                          asChild
                          size="sm"
                          variant={task.overdue ? "default" : "outline"}
                          className={cn(
                            "h-8 text-xs",
                            task.overdue && "bg-[#0f7a6e] text-white hover:bg-[#0c675d]",
                          )}
                        >
                          <a href={waHref} target="_blank" rel="noreferrer">
                            <MessageCircleIcon className="size-3.5" />
                            {task.overdue ? `Remind ${firstName}` : `WhatsApp ${firstName}`}
                          </a>
                        </Button>
                      )}
                      {mode === "member" && !paper && isOpen && (
                        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                          <Link href={`/work/new?task=${task.id}`}>
                            <FilePlus2Icon className="size-3.5" /> Log work
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Send back to fix dialog (Admin) */}
      {mode === "admin" && (
        <Dialog open={sendBack} onOpenChange={setSendBack}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send back to fix</DialogTitle>
              <DialogDescription>
                {firstName} gets a notification with your note. The task opens again until they fix it and mark it done.
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

      {/* Delete confirmation AlertDialog (Admin) */}
      {mode === "admin" && !readOnly && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this task?</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="text-foreground font-medium">{heading}</span> and its attached files will be permanently
                removed. If you might need it later, cancel the task instead.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Keep task</AlertDialogCancel>
              <AlertDialogAction variant="destructive" disabled={pending} onClick={remove}>
                {pending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />} Delete task
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

function MetaCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "destructive" | "warning" | "success";
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{label}</p>
      <p
        className={cn(
          "truncate text-xs font-medium sm:text-[13px]",
          tone === "destructive" && "text-destructive font-semibold",
          tone === "warning" && "text-amber-700 dark:text-warning font-semibold",
          tone === "success" && "text-success font-semibold",
        )}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
