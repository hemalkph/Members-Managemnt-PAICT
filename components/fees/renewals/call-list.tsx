"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRightLeftIcon,
  CalendarCheckIcon,
  HandCoinsIcon,
  Loader2Icon,
  LogOutIcon,
  MessageCircleIcon,
  PhoneOffIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setFollowupOutcomeAction } from "@/lib/actions/renewals";
import type { FollowupOutcomeInput } from "@/lib/core/validation";
import type { ComparedStudent } from "@/lib/fees/compare";
import { formatPhoneDisplay } from "@/lib/fees/phone";
import { DROP_REASONS, type DropReason } from "@/lib/fees/renewals";

type Outcome = FollowupOutcomeInput["outcome"];
type Moved = { student: ComparedStudent; to: { classId: string; className: string } };

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Colombo" }) : "–";

/** Students to phone today, plus unpaid students found on another class's list. A row leaves once handled. */
export function CallList({
  classId,
  month,
  today,
  calls,
  moved,
  classes,
  canEdit,
}: {
  classId: string;
  month: string;
  today: string;
  calls: ComparedStudent[];
  moved: Moved[];
  classes: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    student: ComparedStudent;
    outcome: "promised" | "dropped" | "moved_class";
    suggested?: string;
  } | null>(null);
  const [, startTransition] = useTransition();

  const save = (student: ComparedStudent, outcome: Outcome, extra: Partial<FollowupOutcomeInput> = {}) => {
    setBusy(student.studentKey);
    startTransition(async () => {
      const res = await setFollowupOutcomeAction({
        class_id: classId,
        due_month: month,
        student_key: student.studentKey,
        student_name: student.fullName,
        whatsapp_norm: student.contactPhone ?? student.whatsappNorm ?? null,
        outcome,
        ...extra,
      });
      setBusy(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      setDialog(null);
      setDone((prev) => new Set(prev).add(student.studentKey));
      router.refresh();
    });
  };

  const rowMotion = {
    layout: !reduce,
    initial: false as const,
    exit: reduce ? { opacity: 0 } : { opacity: 0, x: 8 },
    transition: { duration: 0.2, ease: EASE_OUT },
  };

  const openCalls = calls.filter((c) => !done.has(c.studentKey));
  const openMoved = moved.filter((m) => !done.has(m.student.studentKey));

  return (
    <div className="space-y-4">
      {openMoved.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium">Found on another class&apos;s list</p>
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {openMoved.map((m) => (
                <motion.li
                  key={`moved-${m.student.studentKey}`}
                  {...rowMotion}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{m.student.fullName}</span>
                    <span className="text-muted-foreground"> · found in {m.to.className}</span>
                  </span>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === m.student.studentKey}
                      onClick={() => save(m.student, "moved_class", { moved_to: m.to.classId, called: false })}
                    >
                      {busy === m.student.studentKey ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <ArrowRightLeftIcon />
                      )}
                      Confirm moved
                    </Button>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}

      {openCalls.length === 0 ? (
        <p className="text-muted-foreground text-sm">No one to call today.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          <AnimatePresence initial={false}>
            {openCalls.map((s) => {
              const isBusy = busy === s.studentKey;
              return (
                <motion.li key={s.studentKey} {...rowMotion} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="font-medium">{s.fullName}</p>
                    {s.contactPhone ? (
                      <a
                        href={`https://wa.me/${s.contactPhone}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary inline-flex items-center gap-1 text-sm tabular-nums hover:underline"
                      >
                        <MessageCircleIcon className="size-3.5" />
                        {formatPhoneDisplay(s.contactPhone)}
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-sm">No WhatsApp number</span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {s.messageCount} reminder{s.messageCount === 1 ? "" : "s"} · last {shortDate(s.lastMessagedAt)}
                    {s.callCount > 0 && ` · called ${s.callCount}×`}
                    {s.followupStatus === "promised" && s.promisedBy && ` · promised by ${shortDate(s.promisedBy)}`}
                  </p>
                  {canEdit && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" disabled={isBusy} onClick={() => save(s, "no_answer")}>
                        {isBusy ? <Loader2Icon className="animate-spin" /> : <PhoneOffIcon />}
                        No answer
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => setDialog({ student: s, outcome: "promised" })}
                      >
                        <CalendarCheckIcon /> Promised…
                      </Button>
                      <Button size="sm" variant="outline" disabled={isBusy} onClick={() => save(s, "cant_afford")}>
                        <HandCoinsIcon /> Can&apos;t afford
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() =>
                          setDialog({
                            student: s,
                            outcome: "moved_class",
                            suggested: moved.find((m) => m.student.studentKey === s.studentKey)?.to.classId,
                          })
                        }
                      >
                        <ArrowRightLeftIcon /> Moved class…
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => setDialog({ student: s, outcome: "dropped" })}
                      >
                        <LogOutIcon /> Left…
                      </Button>
                    </div>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {dialog && (
        <OutcomeDialog
          key={`${dialog.student.studentKey}-${dialog.outcome}`}
          outcome={dialog.outcome}
          student={dialog.student}
          today={today}
          classes={classes.filter((c) => c.id !== classId)}
          suggested={dialog.suggested}
          busy={busy === dialog.student.studentKey}
          onClose={() => setDialog(null)}
          onSave={(extra) => save(dialog.student, dialog.outcome, extra)}
        />
      )}
    </div>
  );
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TITLES = {
  promised: "Promised to pay",
  dropped: "Left the class",
  moved_class: "Moved to another class",
} as const;

function OutcomeDialog({
  outcome,
  student,
  today,
  classes,
  suggested,
  busy,
  onClose,
  onSave,
}: {
  outcome: "promised" | "dropped" | "moved_class";
  student: ComparedStudent;
  today: string;
  classes: { id: string; name: string }[];
  suggested?: string;
  busy: boolean;
  onClose: () => void;
  onSave: (extra: Partial<FollowupOutcomeInput>) => void;
}) {
  const [date, setDate] = useState(addDays(today, 3));
  const [reason, setReason] = useState<DropReason | "">("");
  const [movedTo, setMovedTo] = useState(suggested ?? "");
  const [note, setNote] = useState("");

  const ready = outcome === "promised" ? Boolean(date) : outcome === "dropped" ? Boolean(reason) : Boolean(movedTo);
  const submit = () => {
    if (!ready) return;
    onSave({
      promised_by: outcome === "promised" ? date : null,
      reason: outcome === "dropped" ? (reason as DropReason) : null,
      moved_to: outcome === "moved_class" ? movedTo : null,
      note: note.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{TITLES[outcome]}</DialogTitle>
          <DialogDescription>{student.fullName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {outcome === "promised" && (
            <div className="space-y-1.5">
              <Label htmlFor="promised-by">They will pay by</Label>
              <Input
                id="promised-by"
                type="date"
                min={today}
                max={addDays(today, 45)}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          )}
          {outcome === "dropped" && (
            <div className="space-y-1.5">
              <Label htmlFor="drop-reason">Why they left</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as DropReason)}>
                <SelectTrigger id="drop-reason" className="w-full">
                  <SelectValue placeholder="Pick a reason" />
                </SelectTrigger>
                <SelectContent>
                  {DROP_REASONS.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {outcome === "moved_class" && (
            <div className="space-y-1.5">
              <Label htmlFor="moved-to">Moved to</Label>
              <Select value={movedTo} onValueChange={setMovedTo}>
                <SelectTrigger id="moved-to" className="w-full">
                  <SelectValue placeholder="Pick the class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="outcome-note">Note (optional)</Label>
            <Input id="outcome-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !ready}>
            {busy && <Loader2Icon className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
