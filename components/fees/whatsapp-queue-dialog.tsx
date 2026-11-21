"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MessageCircleIcon,
  PhoneOffIcon,
  SkipForwardIcon,
  SmilePlusIcon,
  UserMinusIcon,
  UserRoundCheckIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { WhatsAppPreview } from "@/components/fees/whatsapp-preview";
import { setFeeFollowupAction } from "@/lib/actions/fees";
import type { ComparedStudent } from "@/lib/fees/compare";
import { formatPhoneDisplay } from "@/lib/fees/phone";
import type { FeeTemplateItem } from "@/lib/fees/queries";
import { EMOJI_GROUPS, feeWhatsAppUrl, renderFeeMessage, templateUsesTutes } from "@/lib/fees/templates";
import type { FeeFollowupStatus } from "@/lib/supabase/database.types";

export function WhatsAppQueueDialog({
  open,
  onOpenChange,
  students,
  templates,
  initialTemplateId,
  classId,
  className,
  dueMonth,
  dueMonthLabel,
  prevMonthLabel,
  currMonthTutes,
  nextMonthTutes,
  canEdit,
  onStudentUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: ComparedStudent[];
  templates: FeeTemplateItem[];
  initialTemplateId: string;
  classId: string;
  className: string;
  dueMonth: string;
  dueMonthLabel: string;
  prevMonthLabel: string;
  currMonthTutes: string[];
  nextMonthTutes: string[];
  canEdit: boolean;
  onStudentUpdated: (patch: {
    studentKey: string;
    status: FeeFollowupStatus;
    messageCount?: number;
    lastMessagedAt?: string | null;
  }) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [templateId, setTemplateId] = useState(initialTemplateId || templates[0]?.id || "");
  const [includeMessaged, setIncludeMessaged] = useState(false);
  const [skipFreeCards, setSkipFreeCards] = useState(true);
  const [index, setIndex] = useState(0);
  const [customDraft, setCustomDraft] = useState<{ key: string; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Resync selected template, queue position, and draft whenever the dialog opens or switches class/month.
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevContextKey, setPrevContextKey] = useState(`${classId}|${dueMonth}`);
  const contextKey = `${classId}|${dueMonth}`;
  if ((open && !prevOpen) || contextKey !== prevContextKey) {
    setPrevOpen(open);
    setPrevContextKey(contextKey);
    setTemplateId(initialTemplateId || templates[0]?.id || "");
    setIndex(0);
    setCustomDraft(null);
  } else if (open !== prevOpen) {
    setPrevOpen(open);
  }

  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? templates[0] ?? null,
    [templates, templateId],
  );

  // Build active queue of due students (also includes messaged students whose WhatsApp # was just updated).
  const queue = useMemo(() => {
    return students.filter((s) => {
      if (s.kind !== "due") return false;
      if (s.followupStatus === "excused" || s.followupStatus === "dropped") return false;
      if (!includeMessaged && s.followupStatus === "messaged" && !s.contactPhoneChanged) return false;
      if (skipFreeCards && /free/i.test(s.primaryLabel)) return false;
      return true;
    });
  }, [students, includeMessaged, skipFreeCards]);

  const safeIndex = queue.length === 0 ? 0 : Math.min(index, queue.length - 1);
  const current = queue[safeIndex] ?? null;

  const renderedDefault = useMemo(() => {
    if (!current || !activeTemplate) return "";
    return renderFeeMessage(activeTemplate.body, {
      fullName: current.fullName,
      className,
      monthLabel: dueMonthLabel,
      prevMonthLabel,
      amount: current.prevAmount,
      institute: current.institute,
      label: current.primaryLabel,
      tutes: currMonthTutes,
      nextMonthTutes,
    });
  }, [current, activeTemplate, className, dueMonthLabel, prevMonthLabel, currMonthTutes, nextMonthTutes]);

  const missingTutesWarning = Boolean(activeTemplate && templateUsesTutes(activeTemplate.body) && currMonthTutes.length === 0);

  const draftKey = current ? `${current.studentKey}:${activeTemplate?.id ?? ""}` : "";
  const messageText = customDraft && customDraft.key === draftKey ? customDraft.text : renderedDefault;

  const totalDueActive = useMemo(
    () => students.filter((s) => s.kind === "due" && s.followupStatus !== "excused" && s.followupStatus !== "dropped").length,
    [students],
  );
  const messagedCount = useMemo(
    () => students.filter((s) => s.kind === "due" && s.followupStatus === "messaged").length,
    [students],
  );
  const progressPct = totalDueActive > 0 ? Math.round((messagedCount / totalDueActive) * 100) : 100;

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const base = messageText;
    if (!el) {
      setCustomDraft({ key: draftKey, text: `${base}${emoji}` });
      return;
    }
    const start = el.selectionStart ?? base.length;
    const end = el.selectionEnd ?? base.length;
    const next = `${base.slice(0, start)}${emoji}${base.slice(end)}`;
    setCustomDraft({ key: draftKey, text: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const openAndMarkSent = () => {
    if (!current || !current.contactPhone) return;
    const url = feeWhatsAppUrl(current.contactPhone, messageText);
    window.open(url, "_blank", "noopener,noreferrer");

    if (!canEdit) return;
    startTransition(async () => {
      const res = await setFeeFollowupAction({
        class_id: classId,
        due_month: dueMonth,
        student_key: current.studentKey,
        student_name: current.fullName,
        email_norm: current.emailNorm,
        whatsapp_norm: current.contactPhone,
        status: "messaged",
        template_id: activeTemplate?.id ?? null,
        increment_message: true,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onStudentUpdated({
        studentKey: current.studentKey,
        status: "messaged",
        messageCount: res.data?.messageCount,
        lastMessagedAt: res.data?.lastMessagedAt,
      });
      setCustomDraft(null);
      if (includeMessaged) {
        setIndex(Math.min(safeIndex + 1, Math.max(0, queue.length - 1)));
      }
    });
  };

  const markStatus = (status: "excused" | "dropped") => {
    if (!current || !canEdit) return;
    startTransition(async () => {
      const res = await setFeeFollowupAction({
        class_id: classId,
        due_month: dueMonth,
        student_key: current.studentKey,
        student_name: current.fullName,
        email_norm: current.emailNorm,
        whatsapp_norm: current.contactPhone,
        status,
        increment_message: false,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        status === "excused" ? `Marked ${current.fullName} as excused` : `Marked ${current.fullName} as left class`,
      );
      onStudentUpdated({ studentKey: current.studentKey, status });
      setCustomDraft(null);
    });
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(messageText);
      toast.success("Message copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircleIcon className="size-5 text-emerald-600 dark:text-emerald-400" />
            WhatsApp Reminder Queue — {className}
          </DialogTitle>
          <DialogDescription>
            {dueMonthLabel} due follow-ups. One click opens WhatsApp with emojis pre-filled and logs the reminder.
          </DialogDescription>
        </DialogHeader>

        {/* Progress & controls */}
        <div className="space-y-3 rounded-xl border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium">
              Progress: {messagedCount} / {totalDueActive} messaged ({progressPct}%)
            </span>
            <span className="text-muted-foreground">{queue.length} in current queue</span>
          </div>
          <Progress value={progressPct} className="h-2" />

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex min-w-[200px] flex-1 items-center gap-2">
              <Label htmlFor="queue-tpl" className="shrink-0 text-xs">
                Template
              </Label>
              <Select
                value={activeTemplate?.id ?? ""}
                onValueChange={(v) => {
                  setTemplateId(v);
                  setCustomDraft(null);
                }}
              >
                <SelectTrigger id="queue-tpl" className="h-8 text-xs">
                  <SelectValue placeholder="Choose template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <Switch checked={skipFreeCards} onCheckedChange={setSkipFreeCards} />
                Skip Free card
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <Switch
                  checked={includeMessaged}
                  onCheckedChange={(v) => {
                    setIncludeMessaged(v);
                    setIndex(0);
                  }}
                />
                Include already messaged
              </label>
            </div>
          </div>
        </div>

        {missingTutesWarning && (
          <div className="bg-warning/15 flex items-start gap-2 rounded-lg p-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              This template includes a tutes placeholder, but no tutes are scheduled for <strong>{dueMonthLabel}</strong>{" "}
              yet. Add them in the <strong>Tutes</strong> tab so their names appear automatically.
            </span>
          </div>
        )}

        {!current ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <CheckCircle2Icon className="size-10 text-emerald-600 dark:text-emerald-400" />
            <p className="text-base font-semibold">Everyone in this queue has been messaged!</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Turn on &ldquo;Include already messaged&rdquo; above if you want to send a second reminder round.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Student header card */}
            <div className="bg-muted/40 flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3.5">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="tabular-nums">
                    {safeIndex + 1} / {queue.length}
                  </Badge>
                  <p className="text-base font-semibold">{current.fullName}</p>
                  {current.primaryLabel && <Badge variant="secondary">{current.primaryLabel}</Badge>}
                  {current.messageCount > 0 && (
                    <Badge variant="warning">Already messaged ×{current.messageCount}</Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {current.email || "No email"}
                  {current.institute ? ` · ${current.institute}` : ""}
                  {current.district ? ` · ${current.district}` : ""}
                  {current.prevAmount !== null ? ` · Prev: Rs. ${current.prevAmount.toLocaleString("en-LK")}` : ""}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-sm font-medium tabular-nums">
                  {current.contactPhone ? (
                    <>
                      <span>{formatPhoneDisplay(current.contactPhone)}</span>
                      {current.contactPhoneChanged && (
                        <Badge variant="warning" className="text-[10px]">
                          New WhatsApp #
                          {current.previousMessagedPhone
                            ? ` (prev: ${formatPhoneDisplay(current.previousMessagedPhone)})`
                            : ""}
                        </Badge>
                      )}
                    </>
                  ) : (
                    <span className="text-destructive flex items-center gap-1 text-xs">
                      <PhoneOffIcon className="size-3.5" /> No WhatsApp number
                      {current.mobileNorm ? ` (mobile only: ${formatPhoneDisplay(current.mobileNorm)})` : ""}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8"
                  aria-label="Previous student"
                  disabled={safeIndex === 0}
                  onClick={() => setIndex(Math.max(0, safeIndex - 1))}
                >
                  <ChevronLeftIcon className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-8"
                  aria-label="Next student"
                  disabled={safeIndex >= queue.length - 1}
                  onClick={() => setIndex(Math.min(queue.length - 1, safeIndex + 1))}
                >
                  <ChevronRightIcon className="size-4" />
                </Button>
              </div>
            </div>

            {/* Editable message + Live preview */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="queue-msg" className="text-xs">
                    Message for {current.fullName.split(" ")[0]} (editable)
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                        <SmilePlusIcon className="size-3.5" /> Emoji
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-64 space-y-2.5 p-2.5">
                      {EMOJI_GROUPS.map((g) => (
                        <div key={g.label} className="space-y-1">
                          <p className="text-muted-foreground text-[11px] font-medium">{g.label}</p>
                          <div className="flex flex-wrap gap-1">
                            {g.emojis.map((em) => (
                              <button
                                key={em}
                                type="button"
                                onClick={() => insertEmoji(em)}
                                className="hover:bg-accent flex size-7 items-center justify-center rounded text-base"
                              >
                                {em}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </PopoverContent>
                  </Popover>
                </div>
                <Textarea
                  ref={textareaRef}
                  id="queue-msg"
                  value={messageText}
                  onChange={(e) => setCustomDraft({ key: draftKey, text: e.target.value })}
                  rows={8}
                  spellCheck={false}
                  className="text-sm leading-relaxed"
                />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium">WhatsApp preview</p>
                <WhatsAppPreview text={messageText} recipientLabel={current.fullName} />
              </div>
            </div>

            {/* Action bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => void copyMessage()}>
                  <CopyIcon /> Copy text
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeIndex >= queue.length - 1}
                  onClick={() => setIndex(Math.min(queue.length - 1, safeIndex + 1))}
                >
                  <SkipForwardIcon /> Skip
                </Button>
                {canEdit && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => markStatus("excused")}
                    >
                      <UserRoundCheckIcon /> Excused
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => markStatus("dropped")}
                    >
                      <UserMinusIcon /> Left class
                    </Button>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                {current.contactPhone && (
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={openAndMarkSent}
                    className="bg-[#0f7a6e] text-white hover:bg-[#0c675d]"
                  >
                    {pending ? <Loader2Icon className="animate-spin" /> : <MessageCircleIcon />}
                    {canEdit ? "Open WhatsApp & Mark Sent" : "Open in WhatsApp"}
                    <ExternalLinkIcon className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
