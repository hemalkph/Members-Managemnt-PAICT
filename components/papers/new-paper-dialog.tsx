"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { CalendarDaysIcon, FilePlus2Icon, Loader2Icon, RotateCcwIcon, UsersRoundIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { createPaperAction, setPaperDefaultOwnersAction } from "@/lib/actions/papers";
import type { PaperStageName } from "@/lib/database.types";
import { formatDay as day } from "@/lib/format";
import { addDays, defaultExamDay, defaultSchedule, onlineExamDay, STAGES, type PaperMedium } from "@/lib/papers";
import { cn } from "@/lib/utils";

type StageState = { stage: PaperStageName; owner_id: string; start_date: string; due_date: string; skip: boolean };
type Part = "full" | "split" | "mcq" | "essay";
const NONE = "none";

/** Owners that follow another stage's owner until changed by hand. */
const FOLLOWS: Partial<Record<PaperStageName, PaperStageName>> = {
  review_si: "create_si", // the creator reviews the Sinhala paper
  review_en: "convert", // the converter reviews the English paper
  typeset_en: "typeset_si",
  handover: "typeset_si", // the type setter fixes it and sends the PDFs
};

type Owners = Partial<Record<PaperStageName, string>>;

function planStages(examDay: string, owners: Owners = {}): StageState[] {
  const schedule = examDay ? defaultSchedule(examDay) : null;
  return STAGES.map((s) => ({
    stage: s.stage,
    owner_id: owners[s.stage] ?? "",
    start_date: schedule?.[s.stage].start ?? "",
    due_date: schedule?.[s.stage].due ?? "",
    skip: false,
  }));
}

const looksBilingual = (text: string) => /\bRFP\b|ranking/i.test(text);

/** Admins: add a paper or tute, with the class's weekly flow filled in. */
export function NewPaperDialog({
  members,
  exams,
  defaultExam,
  today,
  nextExamDay,
  defaultOwners = {},
}: {
  /** busy = due dates of the member's open and upcoming tasks (for the workload check). */
  members: { id: string; name: string; busy: string[] }[];
  exams: { id: string; label: string; examDate: string | null }[];
  defaultExam?: string;
  today: string;
  /** The Wednesday after the last planned paper, so a new paper takes the next free week. */
  nextExamDay?: string;
  /** The usual paper team (filled in on every new paper). */
  defaultOwners?: Owners;
}) {
  const router = useRouter();
  const startExamDay = () => exams.find((e) => e.id === defaultExam)?.examDate ?? nextExamDay ?? defaultExamDay(today);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"paper" | "tute">("paper");
  const [medium, setMedium] = useState<PaperMedium>("si");
  const [part, setPart] = useState<Part>("full");
  const [examId, setExamId] = useState(defaultExam ?? "");
  const [exam2Id, setExam2Id] = useState("");
  const [examDay, setExamDay] = useState(startExamDay);
  const [notes, setNotes] = useState("");
  const usualTeam = (): Owners =>
    Object.fromEntries(
      Object.entries(defaultOwners).filter(([, id]) => id && members.some((m) => m.id === id)),
    ) as Owners;
  const [stages, setStages] = useState<StageState[]>(() => planStages(startExamDay(), usualTeam()));
  const [savingTeam, startSavingTeam] = useTransition();
  const [pending, startTransition] = useTransition();
  // Things the admin changed by hand are never overwritten automatically.
  const touched = useRef({ medium: false, owners: new Set<PaperStageName>() });

  const english = medium === "both";
  const neededStages = STAGES.filter((s) => english || !s.english);

  const setStage = (stage: PaperStageName, patch: Partial<StageState>) =>
    setStages((prev) => prev.map((s) => (s.stage === stage ? { ...s, ...patch } : s)));

  const setOwner = (stage: PaperStageName, ownerId: string) => {
    touched.current.owners.add(stage);
    setStages((prev) =>
      prev.map((s) => {
        if (s.stage === stage) return { ...s, owner_id: ownerId };
        // e.g. picking the creator also makes them the Sinhala reviewer.
        if (FOLLOWS[s.stage] === stage && !touched.current.owners.has(s.stage)) return { ...s, owner_id: ownerId };
        return s;
      }),
    );
  };

  /** New exam day: move every stage's work days with it (owners stay). */
  const applyExamDay = (value: string) => {
    setExamDay(value);
    if (!value) return;
    const schedule = defaultSchedule(value);
    setStages((prev) =>
      prev.map((s) => ({ ...s, start_date: schedule[s.stage].start, due_date: schedule[s.stage].due })),
    );
  };

  const autoMedium = (text: string) => {
    if (!touched.current.medium) setMedium(looksBilingual(text) ? "both" : "si");
  };

  const reset = () => {
    const d = startExamDay();
    touched.current = { medium: false, owners: new Set() };
    setTitle("");
    setKind("paper");
    setMedium("si");
    setPart("full");
    setExamId(defaultExam ?? "");
    setExam2Id("");
    setExamDay(d);
    setNotes("");
    setStages(planStages(d, usualTeam()));
  };

  /** Workload check: the member's tasks due in this paper's work week (Mon before → exam day). */
  const busyThisWeek = (memberId: string) => {
    const m = members.find((x) => x.id === memberId);
    if (!m) return 0;
    if (!examDay) return m.busy.length;
    const from = addDays(examDay, -9);
    return m.busy.filter((d) => d >= from && d <= examDay).length;
  };

  const saveTeam = () =>
    startSavingTeam(async () => {
      const owners = Object.fromEntries(stages.map((s) => [s.stage, s.skip ? "" : s.owner_id]));
      const result = await setPaperDefaultOwnersAction({ owners });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const kept = stages.filter((s) => !s.skip && (english || !STAGES.find((x) => x.stage === s.stage)?.english));
    if (kept.length === 0) {
      toast.error("Keep at least one stage");
      return;
    }
    startTransition(async () => {
      const result = await createPaperAction({
        title,
        kind,
        medium,
        part,
        exam_id: examId,
        exam2_id: part === "split" ? exam2Id : "",
        exam_day: examDay,
        notes,
        stages,
      });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Could not add the paper." : result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      reset();
      router.push(part === "split" ? "/admin/papers" : `/papers/${result.data.id}`);
    });
  };

  const examLabel = kind === "tute" ? "Release day" : "Exam day (physical centres)";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <FilePlus2Icon /> New paper
        </Button>
      </DialogTrigger>
      <DialogContent data-lenis-prevent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={save} className="grid min-w-0 gap-5 [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>New paper or tute</DialogTitle>
            <DialogDescription>
              The weekly flow and work days are filled in from the exam day. Change any owner or date you need.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="paper-title">Title</Label>
              <Input
                id="paper-title"
                value={title}
                maxLength={140}
                autoFocus
                placeholder="e.g. RFP 05"
                onChange={(e) => {
                  setTitle(e.target.value);
                  autoMedium(`${e.target.value} ${exams.find((x) => x.id === examId)?.label ?? ""}`);
                }}
              />
            </div>
            <div className="grid min-w-0 gap-2">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as "paper" | "tute")}>
                <SelectTrigger aria-label="Type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paper">Paper</SelectItem>
                  <SelectItem value="tute">Tute</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-2">
              <Label>Medium</Label>
              <Tabs
                value={medium}
                onValueChange={(v) => {
                  touched.current.medium = true;
                  setMedium(v as PaperMedium);
                }}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="si">Sinhala only</TabsTrigger>
                  <TabsTrigger value="both">Sinhala + English</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="text-muted-foreground text-xs">
                {english ? "Converted to English and type set in both mediums." : "English stages are skipped."}
              </p>
            </div>
            <div className="grid min-w-0 gap-2">
              <Label>Paper</Label>
              <Select value={part} onValueChange={(v) => setPart(v as Part)}>
                <SelectTrigger aria-label="Paper part" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full paper – 1 week</SelectItem>
                  <SelectItem value="split">Full paper – 2 weeks</SelectItem>
                  <SelectItem value="mcq">MCQ only</SelectItem>
                  <SelectItem value="essay">SE & Essay only</SelectItem>
                </SelectContent>
              </Select>
              {part === "split" && (
                <p className="text-muted-foreground text-xs">Adds two papers: MCQ this week, SE & Essay the next.</p>
              )}
            </div>
          </div>

          <div className={cn("grid gap-4", part === "split" ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
            <div className="grid min-w-0 gap-2">
              <Label>{part === "split" ? "Exam for MCQ" : "Exam / test"}</Label>
              <Select
                value={examId || NONE}
                onValueChange={(v) => {
                  const id = v === NONE ? "" : v;
                  setExamId(id);
                  const exam = exams.find((x) => x.id === id);
                  if (exam?.examDate) applyExamDay(exam.examDate);
                  autoMedium(`${title} ${exam?.label ?? ""}`);
                }}
              >
                <SelectTrigger aria-label="Exam" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not for an exam</SelectItem>
                  {exams.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {part === "split" && (
              <div className="grid min-w-0 gap-2">
                <Label>Exam for SE & Essay</Label>
                <Select value={exam2Id || NONE} onValueChange={(v) => setExam2Id(v === NONE ? "" : v)}>
                  <SelectTrigger aria-label="Exam for SE and Essay" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Same as MCQ</SelectItem>
                    {exams.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="paper-exam-day">{examLabel}</Label>
              <div className="flex gap-2">
                <Input id="paper-exam-day" type="date" value={examDay} onChange={(e) => applyExamDay(e.target.value)} />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Reset all work days to the default"
                  aria-label="Reset all work days to the default"
                  disabled={!examDay}
                  onClick={() => applyExamDay(examDay)}
                >
                  <RotateCcwIcon />
                </Button>
              </div>
            </div>
          </div>

          {examDay && kind === "paper" && (
            <p className="bg-primary/5 text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs">
              <CalendarDaysIcon className="text-primary size-4" />
              <span>
                Physical centres: <b className="text-foreground">{day(examDay)}</b>
              </span>
              <span>
                Online: <b className="text-foreground">{day(onlineExamDay(examDay))}</b>
              </span>
              {part === "split" && (
                <span>
                  SE & Essay (physical): <b className="text-foreground">{day(addDays(examDay, 7))}</b>
                </span>
              )}
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">Stages and work days</p>
              <div className="flex items-center gap-2">
                <p className="text-muted-foreground hidden text-xs sm:block">
                  {neededStages.length} stages{part === "split" ? " · same plan for both weeks" : ""}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={saveTeam}
                  disabled={savingTeam || stages.every((s) => !s.owner_id)}
                  title="Fill in these owners on every new paper"
                >
                  {savingTeam ? <Loader2Icon className="animate-spin" /> : <UsersRoundIcon />}
                  Save as usual team
                </Button>
              </div>
            </div>
            <div className="divide-y rounded-lg border">
              {STAGES.map((meta, i) => {
                const st = stages.find((s) => s.stage === meta.stage)!;
                const notNeeded = Boolean(meta.english && !english);
                const off = st.skip || notNeeded;
                return (
                  <div
                    key={meta.stage}
                    className={cn(
                      "grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_160px_142px_142px_auto] sm:items-center",
                      off && "bg-muted/40",
                    )}
                  >
                    <div className="min-w-0">
                      <p className={cn("text-sm font-medium", off && "text-muted-foreground line-through")}>
                        {i + 1}. {meta.label}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {notNeeded ? "Not needed – Sinhala only" : meta.description}
                      </p>
                    </div>
                    <Select
                      value={st.owner_id || NONE}
                      disabled={off}
                      onValueChange={(v) => setOwner(meta.stage, v === NONE ? "" : v)}
                    >
                      <SelectTrigger aria-label={`${meta.label} owner`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Choose later</SelectItem>
                        {members.map((m) => {
                          const busy = busyThisWeek(m.id);
                          return (
                            <SelectItem
                              key={m.id}
                              value={m.id}
                              hint={
                                <span
                                  className={cn(
                                    "ml-auto pl-3 text-xs",
                                    busy >= 3
                                      ? "font-semibold text-amber-700 dark:text-warning"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {busy === 0 ? "free" : `${busy} that week`}
                                </span>
                              }
                            >
                              {m.name}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-2 sm:contents">
                      <Input
                        type="date"
                        aria-label={`${meta.label} start date`}
                        title="Start"
                        value={st.start_date}
                        disabled={off}
                        onChange={(e) => setStage(meta.stage, { start_date: e.target.value })}
                      />
                      <Input
                        type="date"
                        aria-label={`${meta.label} due date`}
                        title="Due"
                        value={st.due_date}
                        min={st.start_date || undefined}
                        disabled={off}
                        onChange={(e) => setStage(meta.stage, { due_date: e.target.value })}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={off}
                        disabled={notNeeded}
                        onCheckedChange={(v) => setStage(meta.stage, { skip: v })}
                        aria-label={`Skip ${meta.label}`}
                      />
                      Skip
                    </label>
                  </div>
                );
              })}
            </div>
            <p className="text-muted-foreground text-xs">
              Sinhala type setting and conversion run at the same time. Each owner gets their stage as a task when the
              stages before it are done. Next to each name: their tasks already due that week (3+ is busy).
            </p>
          </div>

          <div className="grid min-w-0 gap-2">
            <Label htmlFor="paper-notes">Notes (optional)</Label>
            <Textarea
              id="paper-notes"
              rows={2}
              maxLength={1000}
              value={notes}
              placeholder="e.g. 50 MCQ + 6 structured, A4"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || title.trim().length < 2}>
              {pending && <Loader2Icon className="animate-spin" />}
              {part === "split" ? "Add 2 papers" : "Add paper"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
