"use client";

import { useEffect, useState } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { CoverPhotoPicker } from "@/components/tutes/cover-photo-picker";
import { printReason } from "@/components/tutes/print-plan";
import type { ClassOption, DialogState, PaperOption } from "@/components/tutes/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  countTuteAction,
  createPrintJobAction,
  issueTuteAction,
  receivePrintJobAction,
  savePrinterAction,
  saveTuteAction,
  updatePrintJobAction,
} from "@/lib/actions/tutes";
import type { ActionResult } from "@/lib/core/action-result";
import type { TuteSaveInput } from "@/lib/core/validation";
import { formatDate } from "@/lib/core/format";
import { monthLabel, shiftMonth, todayISO } from "@/lib/core/month";
import type { TuteStockRow } from "@/lib/supabase/database.types";
import { addDaysISO, defaultPrinterIdFor, hallRemaining } from "@/lib/tutes/helpers";
import type { TutePrinter, TutePrintJob } from "@/lib/tutes/queries";
import { cn } from "@/lib/utils";

function NumberField({
  name,
  label,
  defaultValue,
  min = 0,
  step,
  hint,
}: {
  name: string;
  label: string;
  defaultValue?: number | string;
  min?: number;
  step?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`tute-${name}`}>{label}</Label>
      <Input
        id={`tute-${name}`}
        name={name}
        type="number"
        inputMode={step ? "decimal" : "numeric"}
        min={min}
        step={step}
        defaultValue={defaultValue}
      />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

function NoteField({ defaultValue }: { defaultValue?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="tute-note">Note (optional)</Label>
      <Input id="tute-note" name="note" maxLength={300} defaultValue={defaultValue} />
    </div>
  );
}

export function TuteDialog({
  state,
  rows,
  jobs,
  tutesWithHistory,
  reserved,
  coverUrls,
  printers,
  allPrinters,
  papers,
  classes,
  canSchedule,
  month,
  pending,
  uploadingCoverId,
  onSaveNewTute,
  onUploadCover,
  onRemoveCover,
  onClose,
  run,
}: {
  state: DialogState;
  rows: TuteStockRow[];
  jobs: TutePrintJob[];
  tutesWithHistory: Set<string>;
  reserved: Record<string, number>;
  coverUrls: Record<string, string | null>;
  printers: TutePrinter[];
  allPrinters: TutePrinter[];
  papers: PaperOption[];
  classes: ClassOption[];
  canSchedule: boolean;
  month: string;
  pending: boolean;
  uploadingCoverId: string | null;
  onSaveNewTute: (input: TuteSaveInput, coverFile: File | null) => void;
  onUploadCover: (tuteId: string, file: File) => void;
  onRemoveCover: (tuteId: string) => void;
  onClose: () => void;
  run: (fn: () => Promise<ActionResult<unknown>>) => void;
}) {
  const today = todayISO();
  const row = "row" in state ? state.row : null;

  // Live preview + staged cover photo for New Tute
  const [draftName, setDraftName] = useState(row?.name ?? "");
  const [draftCode, setDraftCode] = useState(row?.code ?? "");
  const [stagedCover, setStagedCover] = useState<{ file: File; previewUrl: string } | null>(null);

  useEffect(() => {
    return () => {
      if (stagedCover) URL.revokeObjectURL(stagedCover.previewUrl);
    };
  }, [stagedCover]);

  const stageNewCover = (file: File) => {
    setStagedCover((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file) };
    });
  };

  const clearStagedCover = () => {
    setStagedCover((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  };

  // Count live preview state
  const [countedVal, setCountedVal] = useState<number | "">(state.kind === "count" ? state.row.on_hand : "");

  // Give-out state: default to first class with Hall copies remaining.
  const firstClass = row?.classes.find((c) => hallRemaining(c) > 0) ?? row?.classes[0];
  const [classId, setClassId] = useState(firstClass?.id ?? "");
  const [issueQty, setIssueQty] = useState<number | "">(firstClass ? hallRemaining(firstClass) || "" : "");

  // Damaged live preview state
  const [damagedQty, setDamagedQty] = useState<number | "">("");

  // New-tute optional scheduling state
  const [scheduleIds, setScheduleIds] = useState<string[]>([]);

  // Print job create / edit state
  const editingJob = state.kind === "edit_job" ? state.job : null;
  const initialJobTute = state.kind === "job" ? (row?.tute_id ?? rows[0]?.tute_id ?? "") : "";
  const initialPrinter =
    state.kind === "edit_job"
      ? (state.job.printerId ?? "none")
      : state.kind === "job"
        ? defaultPrinterIdFor(initialJobTute, jobs, printers)
        : "none";
  const initialPrinterObj = printers.find((p) => p.id === initialPrinter);

  const [jobTute, setJobTute] = useState(initialJobTute);
  const [jobQtyOverride, setJobQtyOverride] = useState<number | undefined>(
    state.kind === "job" ? state.suggestedQty : undefined,
  );
  const [editJobQty, setEditJobQty] = useState<number | "">(editingJob ? editingJob.qty : "");
  const [printerId, setPrinterId] = useState(initialPrinter);
  const [dueDate, setDueDate] = useState(
    editingJob ? (editingJob.dueDate ?? "") : initialPrinterObj ? addDaysISO(today, initialPrinterObj.usualDays) : "",
  );
  const [dueDateEdited, setDueDateEdited] = useState(Boolean(editingJob));

  // Receive state (supports picking among multiple open print jobs for one tute + live preview)
  const initialReceiveJob =
    state.kind === "receive" ? (state.jobs.find((j) => j.id === state.initialJobId) ?? state.jobs[0]) : null;
  const [receiveJobId, setReceiveJobId] = useState(initialReceiveJob?.id ?? "");
  const [receiveQty, setReceiveQty] = useState<number | "">(
    initialReceiveJob ? Math.max(initialReceiveJob.qty - initialReceiveJob.receivedQty, 1) : "",
  );

  const [paperId, setPaperId] = useState(row?.paper_id ?? "none");
  const jobRow = rows.find((r) => r.tute_id === jobTute);
  const selectedClass = row?.classes.find((c) => c.id === classId);
  const selectedReceiveJob =
    state.kind === "receive" ? (state.jobs.find((j) => j.id === receiveJobId) ?? state.jobs[0]) : null;

  // For edit_job, include the job's existing printer in the dropdown even if it was later deactivated.
  const jobPrinterOptions = editingJob?.printerId
    ? printers.some((p) => p.id === editingJob.printerId)
      ? printers
      : [...printers, ...allPrinters.filter((p) => p.id === editingJob.printerId)]
    : printers;

  const held = row ? (reserved[row.tute_id] ?? 0) : 0;
  const free = row ? Math.max(row.on_hand - held, 0) : 0;

  const handleSelectJobTute = (nextTuteId: string) => {
    setJobTute(nextTuteId);
    setJobQtyOverride(undefined);
    const nextPrinter = defaultPrinterIdFor(nextTuteId, jobs, printers);
    setPrinterId(nextPrinter);
    if (!dueDateEdited) {
      const p = printers.find((x) => x.id === nextPrinter);
      setDueDate(p ? addDaysISO(today, p.usualDays) : "");
    }
  };

  const handleSelectPrinter = (nextPrinterId: string) => {
    setPrinterId(nextPrinterId);
    if (!dueDateEdited) {
      const p = printers.find((x) => x.id === nextPrinterId);
      setDueDate(p ? addDaysISO(today, p.usualDays) : "");
    }
  };

  const handleSelectReceiveJob = (nextJobId: string) => {
    setReceiveJobId(nextJobId);
    if (state.kind === "receive") {
      const next = state.jobs.find((j) => j.id === nextJobId);
      if (next) setReceiveQty(Math.max(next.qty - next.receivedQty, 1));
    }
  };

  const toggleScheduleClass = (id: string) => {
    setScheduleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
  const num = (f: FormData, k: string) => (text(f, k) === "" ? null : Number(text(f, k)));

  // Live preview calculations & inline guardrails
  const isNotCounted = state.kind === "count" && state.row.status === "not_counted";
  const countIsFirstMove =
    state.kind === "count" ? !tutesWithHistory.has(state.row.tute_id) && state.row.on_hand === 0 : false;
  const countDiff = state.kind === "count" && countedVal !== "" ? countedVal - state.row.on_hand : null;
  const countUnchanged = state.kind === "count" && !isNotCounted && countDiff === 0;

  const issueNum = typeof issueQty === "number" ? issueQty : 0;
  const issueOverFree = state.kind === "issue" && issueNum > free;

  const damagedNum = typeof damagedQty === "number" ? damagedQty : 0;
  const damagedOverOnHand = state.kind === "damaged" && row !== null && damagedNum > row.on_hand;

  const editJobNum = typeof editJobQty === "number" ? editJobQty : 0;
  const editJobTooLow = editingJob !== null && editJobQty !== "" && editJobNum < Math.max(editingJob.receivedQty, 1);

  const receiveNum = typeof receiveQty === "number" ? receiveQty : 0;
  const receiveRemaining = selectedReceiveJob ? Math.max(selectedReceiveJob.qty - selectedReceiveJob.receivedQty, 0) : 0;
  const receiveAfterTotal = selectedReceiveJob ? selectedReceiveJob.receivedQty + receiveNum : 0;

  const submitDisabled =
    pending ||
    countUnchanged ||
    (state.kind === "count" && countedVal === "") ||
    issueOverFree ||
    (state.kind === "issue" && issueNum < 1) ||
    damagedOverOnHand ||
    (state.kind === "damaged" && damagedNum < 1) ||
    editJobTooLow ||
    (state.kind === "edit_job" && editJobNum < 1) ||
    (state.kind === "receive" && receiveNum < 1);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitDisabled) return;
    const f = new FormData(e.currentTarget);
    switch (state.kind) {
      case "count":
        return run(() => countTuteAction({ tute_id: state.row.tute_id, counted: countedVal === "" ? -1 : countedVal, note: text(f, "note") }));
      case "issue":
        return run(() =>
          issueTuteAction({
            tute_id: state.row.tute_id,
            qty: issueNum,
            kind: "class_issue",
            class_id: classId || null,
            month,
            note: text(f, "note"),
          }),
        );
      case "damaged":
        return run(() =>
          issueTuteAction({
            tute_id: state.row.tute_id,
            qty: damagedNum,
            kind: "damaged",
            class_id: null,
            month,
            note: text(f, "note"),
          }),
        );
      case "tute": {
        const input: TuteSaveInput = {
          id: state.row?.tute_id,
          name: text(f, "name"),
          code: text(f, "code"),
          is_active: state.row ? f.get("is_active") === "on" : true,
          pages: num(f, "pages"),
          reorder_level: num(f, "reorder_level"),
          print_batch: num(f, "print_batch") ?? 1,
          paper_id: paperId === "none" ? null : paperId,
          opening_stock: state.row ? null : num(f, "opening_stock"),
          schedule_class_ids: !state.row && canSchedule ? scheduleIds : undefined,
          schedule_month: !state.row && canSchedule && scheduleIds.length > 0 ? month : undefined,
        };
        if (!state.row) {
          return onSaveNewTute(input, stagedCover?.file ?? null);
        }
        return run(() => saveTuteAction(input));
      }
      case "job":
        return run(() =>
          createPrintJobAction({
            tute_id: jobTute,
            qty: num(f, "qty") ?? 0,
            printer_id: printerId === "none" ? null : printerId,
            due_date: dueDate || null,
            cost: num(f, "cost"),
            note: text(f, "note"),
          }),
        );
      case "edit_job":
        return run(() =>
          updatePrintJobAction({
            id: state.job.id,
            qty: editJobNum,
            printer_id: printerId === "none" ? null : printerId,
            due_date: dueDate || null,
            cost: num(f, "cost"),
            note: text(f, "note"),
          }),
        );
      case "receive":
        if (!selectedReceiveJob) return;
        return run(() =>
          receivePrintJobAction({
            id: selectedReceiveJob.id,
            qty: receiveNum,
            cost: num(f, "cost"),
          }),
        );
      case "printer":
        return run(() =>
          savePrinterAction({
            id: state.printer?.id,
            name: text(f, "name"),
            phone: text(f, "phone"),
            notes: text(f, "notes"),
            usual_days: num(f, "usual_days") ?? 7,
            is_active: state.printer ? f.get("is_active") === "on" : true,
          }),
        );
    }
  };

  const title = {
    count: `Count ${row?.name ?? ""}`,
    issue: `Give out ${row?.name ?? ""}`,
    damaged: `Damaged copies of ${row?.name ?? ""}`,
    tute: row ? `Edit ${row.name}` : "New tute",
    job: row ? `Print job for ${row.name}` : "New print job",
    edit_job: `Edit print job · ${editingJob?.tuteName ?? ""}`,
    receive: "Printed copies received",
    printer: state.kind === "printer" && state.printer ? "Edit printer" : "Add printer",
  }[state.kind];

  const submitLabel = {
    count: "Save count",
    issue: issueNum > 0 ? `Give ${issueNum} copies` : "Give out",
    damaged: damagedNum > 0 ? `Mark ${damagedNum} damaged` : "Mark damaged",
    tute: row ? "Save changes" : "Add tute",
    job: "Create print job",
    edit_job: "Save print job",
    receive: receiveNum > 0 ? `Record ${receiveNum} received` : "Record received",
    printer: state.kind === "printer" && state.printer ? "Save printer" : "Add printer",
  }[state.kind];

  const suggestion = jobQtyOverride ?? jobRow?.print_now ?? 0;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {state.kind === "count" && (
            <DialogDescription>
              Count the copies on the shelf. The difference from {state.row.on_hand} is saved as a count fix (a tute&apos;s first
              count is its opening stock).
            </DialogDescription>
          )}
          {state.kind === "receive" && selectedReceiveJob && (
            <DialogDescription>
              {selectedReceiveJob.tuteName}: {selectedReceiveJob.receivedQty} of {selectedReceiveJob.qty} received so far.
            </DialogDescription>
          )}
          {state.kind === "edit_job" && state.job.receivedQty > 0 && (
            <DialogDescription>
              {state.job.receivedQty} of {state.job.qty} copies already received.
            </DialogDescription>
          )}
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {state.kind === "count" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tute-counted">Copies on the shelf</Label>
                <Input
                  id="tute-counted"
                  name="counted"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100000}
                  value={countedVal}
                  onChange={(e) => setCountedVal(e.target.value === "" ? "" : Number(e.target.value))}
                />
                {countedVal !== "" && countDiff !== null && (
                  <p
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs font-medium tabular-nums",
                      countIsFirstMove && countedVal > 0
                        ? "border-success/30 bg-success/10 text-success"
                        : countDiff === 0
                          ? "bg-muted/50 text-muted-foreground"
                          : countDiff > 0
                            ? "border-success/30 bg-success/10 text-success"
                            : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-warning",
                    )}
                  >
                    {isNotCounted && countedVal === 0
                      ? "Will mark as counted with 0 on the shelf"
                      : countIsFirstMove && countedVal > 0
                        ? `Opening stock: +${countedVal} copies`
                        : countDiff === 0
                          ? "Matches shelf — no change"
                          : `Difference: ${countDiff > 0 ? `+${countDiff}` : countDiff} copies (Count fix)`}
                  </p>
                )}
              </div>
              <NoteField />
            </>
          )}

          {state.kind === "issue" &&
            (state.row.classes.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                This tute isn&apos;t scheduled for any class in {monthLabel(month)}. Schedule it on Classes → Tute plan first.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Class</Label>
                  <Select
                    value={classId}
                    onValueChange={(id) => {
                      setClassId(id);
                      const c = state.row.classes.find((x) => x.id === id);
                      if (c) setIssueQty(hallRemaining(c) || "");
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pick a class" />
                    </SelectTrigger>
                    <SelectContent>
                      {state.row.classes.map((c) => {
                        const hallExp = Math.max(c.expected - c.online, 0);
                        return (
                          <SelectItem key={c.id} value={c.id}>
                            {c.online > 0
                              ? `${c.name} · Hall ${c.hall_given ?? 0} of ${hallExp} given`
                              : `${c.name} · ${c.given} of ${c.expected} given`}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {selectedClass && selectedClass.online > 0 && (
                    <p className="text-muted-foreground text-xs">
                      About {Math.max(selectedClass.expected - selectedClass.online, 0)} Hall students ({selectedClass.online} Online
                      go by Speed Post).
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tute-qty">Copies given</Label>
                  <Input
                    id="tute-qty"
                    name="qty"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={free > 0 ? free : undefined}
                    value={issueQty}
                    onChange={(e) => setIssueQty(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                  {issueOverFree ? (
                    <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-2.5 py-1.5 text-xs font-medium tabular-nums">
                      Only {free} {free === 1 ? "copy" : "copies"} free
                      {held > 0 ? ` (${state.row.on_hand} on hand · ${held} held for Speed Post)` : ""}.
                    </p>
                  ) : issueNum > 0 ? (
                    <p className="bg-muted/50 text-muted-foreground rounded-md border px-2.5 py-1.5 text-xs tabular-nums">
                      After giving: <span className="text-foreground font-medium">{free - issueNum} free</span>
                      {held > 0 ? ` (${state.row.on_hand - issueNum} on hand · ${held} held for Speed Post)` : ""} · counts
                      toward {monthLabel(month)}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      {held > 0
                        ? `${free} free (${state.row.on_hand} on hand · ${held} held for Speed Post)`
                        : `${state.row.on_hand} on hand`}{" "}
                      · counts toward {monthLabel(month)}
                    </p>
                  )}
                </div>
                <NoteField />
              </>
            ))}

          {state.kind === "damaged" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tute-damaged-qty">Damaged copies</Label>
                <Input
                  id="tute-damaged-qty"
                  name="qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={state.row.on_hand > 0 ? state.row.on_hand : undefined}
                  value={damagedQty}
                  onChange={(e) => setDamagedQty(e.target.value === "" ? "" : Number(e.target.value))}
                />
                {damagedOverOnHand ? (
                  <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-2.5 py-1.5 text-xs font-medium tabular-nums">
                    Only {state.row.on_hand} copies on hand.
                  </p>
                ) : damagedNum > 0 ? (
                  <p className="bg-muted/50 text-muted-foreground rounded-md border px-2.5 py-1.5 text-xs tabular-nums">
                    After marking damaged:{" "}
                    <span className="text-foreground font-medium">{state.row.on_hand - damagedNum} on hand</span>
                  </p>
                ) : (
                  <p className="text-muted-foreground text-xs">{state.row.on_hand} on hand</p>
                )}
              </div>
              <NoteField />
            </>
          )}

          {state.kind === "tute" && (
            <>
              <CoverPhotoPicker
                name={draftName}
                code={draftCode}
                coverUrl={state.row ? (coverUrls[state.row.tute_id] ?? null) : (stagedCover?.previewUrl ?? null)}
                paperReady={state.row?.paper_ready}
                busy={Boolean(state.row && uploadingCoverId === state.row.tute_id) || pending}
                onPickFile={(file) => (state.row ? onUploadCover(state.row.tute_id, file) : stageNewCover(file))}
                onRemove={() => (state.row ? onRemoveCover(state.row.tute_id) : clearStagedCover())}
              />
              <div className="space-y-1.5">
                <Label htmlFor="tute-name">Name</Label>
                <Input
                  id="tute-name"
                  name="name"
                  maxLength={150}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="e.g. Unit 07 - Database Systems / ඒකකය 07 නිබන්ධනය"
                  spellCheck={false}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tute-code">Short code (optional)</Label>
                  <Input
                    id="tute-code"
                    name="code"
                    maxLength={30}
                    value={draftCode}
                    onChange={(e) => setDraftCode(e.target.value)}
                    placeholder="e.g. U07"
                  />
                </div>
                <NumberField name="pages" label="Pages (optional)" min={1} defaultValue={state.row?.pages ?? ""} />
              </div>
              {!state.row && (
                <NumberField
                  name="opening_stock"
                  label="Opening copies on shelf (optional)"
                  min={0}
                  hint="Enter how many copies you already have so you don't have to count it separately."
                />
              )}
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  name="print_batch"
                  label="Print in batches of"
                  min={1}
                  defaultValue={state.row?.print_batch ?? 1}
                  hint="Print numbers round up to this."
                />
                <NumberField
                  name="reorder_level"
                  label="Always keep at least"
                  defaultValue={state.row?.reorder_level ?? ""}
                  hint="Optional."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Paper Library PDF (optional)</Label>
                <Select value={paperId} onValueChange={setPaperId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not linked</SelectItem>
                    {papers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {papers.length === 0
                    ? "No Paper Library tutes yet. Add one on Papers (Type: Tute)."
                    : "Linking shows “PDF ready” here and stock on its Paper Library card."}
                </p>
              </div>
              {!state.row && canSchedule && classes.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Schedule for {monthLabel(month, "short")} (optional)</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {classes.map((c) => {
                      const picked = scheduleIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          title={c.batch}
                          onClick={() => toggleScheduleClass(c.id)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors",
                            picked
                              ? "border-primary bg-primary/10 text-primary font-medium"
                              : "bg-muted/40 hover:bg-accent text-muted-foreground",
                          )}
                        >
                          {picked && <CheckIcon className="size-3" />}
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    You can also schedule future months any time on Classes → Tute plan.
                  </p>
                </div>
              )}
              {state.row && (
                <div className="flex items-center gap-2">
                  <Switch id="tute-active" name="is_active" defaultChecked={state.row.is_active} />
                  <Label htmlFor="tute-active">In use (untick to archive)</Label>
                </div>
              )}
            </>
          )}

          {state.kind === "job" && (
            <>
              {!state.row && (
                <div className="space-y-1.5">
                  <Label>Tute</Label>
                  <Select value={jobTute} onValueChange={handleSelectJobTute}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pick a tute" />
                    </SelectTrigger>
                    <SelectContent>
                      {rows.map((r) => (
                        <SelectItem key={r.tute_id} value={r.tute_id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <NumberField
                key={`${jobTute}-${jobQtyOverride ?? "auto"}`}
                name="qty"
                label="Copies"
                min={1}
                defaultValue={suggestion || ""}
                hint={
                  jobQtyOverride
                    ? `Combined run covering ${monthLabel(month, "short")}, ${monthLabel(shiftMonth(month, 1), "short")} and ${monthLabel(shiftMonth(month, 2), "short")}.`
                    : jobRow && suggestion > 0
                      ? `Suggested: ${printReason(jobRow, month)}.`
                      : "This month and next are already covered, with spare copies."
                }
              />
              <div className="space-y-1.5">
                <Label>Printer</Label>
                <Select value={printerId} onValueChange={handleSelectPrinter}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not decided</SelectItem>
                    {printers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · usually {p.usualDays} days
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tute-due">Due (optional)</Label>
                  <Input
                    id="tute-due"
                    name="due_date"
                    type="date"
                    value={dueDate}
                    onChange={(e) => {
                      setDueDate(e.target.value);
                      setDueDateEdited(true);
                    }}
                  />
                </div>
                <NumberField name="cost" label="Cost Rs. (optional)" step="0.01" />
              </div>
              <NoteField />
            </>
          )}

          {state.kind === "edit_job" && editingJob && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tute-edit-qty">Copies</Label>
                <Input
                  id="tute-edit-qty"
                  name="qty"
                  type="number"
                  inputMode="numeric"
                  min={Math.max(editingJob.receivedQty, 1)}
                  value={editJobQty}
                  onChange={(e) => setEditJobQty(e.target.value === "" ? "" : Number(e.target.value))}
                />
                {editJobTooLow ? (
                  <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-2.5 py-1.5 text-xs font-medium">
                    Can&apos;t be less than the {editingJob.receivedQty} copies already received.
                  </p>
                ) : editingJob.receivedQty > 0 && editJobNum === editingJob.receivedQty ? (
                  <p className="border-success/30 bg-success/10 text-success rounded-md border px-2.5 py-1.5 text-xs font-medium">
                    Matches received copies — saving will close this job as Received.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label>Printer</Label>
                <Select value={printerId} onValueChange={handleSelectPrinter}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not decided</SelectItem>
                    {jobPrinterOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · usually {p.usualDays} days{!p.isActive ? " (not used)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tute-due">Due (optional)</Label>
                  <Input
                    id="tute-due"
                    name="due_date"
                    type="date"
                    value={dueDate}
                    onChange={(e) => {
                      setDueDate(e.target.value);
                      setDueDateEdited(true);
                    }}
                  />
                </div>
                <NumberField name="cost" label="Cost Rs. (optional)" step="0.01" defaultValue={editingJob.cost ?? ""} />
              </div>
              <NoteField defaultValue={editingJob.note} />
            </>
          )}

          {state.kind === "receive" && selectedReceiveJob && (
            <>
              {state.jobs.length > 1 && (
                <div className="space-y-1.5">
                  <Label>Print job</Label>
                  <Select value={selectedReceiveJob.id} onValueChange={handleSelectReceiveJob}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {state.jobs.map((j) => (
                        <SelectItem key={j.id} value={j.id}>
                          {j.receivedQty} / {j.qty} received{j.dueDate ? ` · due ${formatDate(j.dueDate)}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="tute-receive-qty">Copies that arrived</Label>
                  {receiveRemaining > 0 && receiveNum !== receiveRemaining && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => setReceiveQty(receiveRemaining)}
                    >
                      All remaining ({receiveRemaining})
                    </Button>
                  )}
                </div>
                <Input
                  id="tute-receive-qty"
                  name="qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={receiveQty}
                  onChange={(e) => setReceiveQty(e.target.value === "" ? "" : Number(e.target.value))}
                />
                {receiveNum > 0 && (
                  <p
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-xs font-medium tabular-nums",
                      receiveAfterTotal >= selectedReceiveJob.qty
                        ? "border-success/30 bg-success/10 text-success"
                        : "bg-muted/50 text-muted-foreground",
                    )}
                  >
                    {receiveAfterTotal >= selectedReceiveJob.qty
                      ? `${receiveAfterTotal} / ${selectedReceiveJob.qty} — job will close as Received`
                      : `${receiveAfterTotal} / ${selectedReceiveJob.qty} — stays Printing (${selectedReceiveJob.qty - receiveAfterTotal} still pending)`}
                  </p>
                )}
              </div>
              <NumberField
                key={`recv-cost-${selectedReceiveJob.id}`}
                name="cost"
                label="Invoice cost Rs. (optional)"
                min={0}
                step="0.01"
                defaultValue={selectedReceiveJob.cost ?? ""}
                hint="Leave blank to keep the existing cost, or enter the final bill."
              />
            </>
          )}

          {state.kind === "printer" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tute-name">Name</Label>
                <Input id="tute-name" name="name" maxLength={100} defaultValue={state.printer?.name} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tute-phone">Phone (optional)</Label>
                  <Input id="tute-phone" name="phone" type="tel" defaultValue={state.printer?.phone} />
                </div>
                <NumberField name="usual_days" label="Usual days to print" min={1} defaultValue={state.printer?.usualDays ?? 7} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tute-notes">Notes (optional)</Label>
                <Input id="tute-notes" name="notes" maxLength={300} defaultValue={state.printer?.notes} />
              </div>
              {state.printer && (
                <div className="flex items-center gap-2">
                  <Switch id="tute-active" name="is_active" defaultChecked={state.printer.isActive} />
                  <Label htmlFor="tute-active">Still used</Label>
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Close
            </Button>
            {!(state.kind === "issue" && state.row.classes.length === 0) && (
              <Button type="submit" disabled={submitDisabled}>
                {pending && <Loader2Icon className="animate-spin" />}
                {submitLabel}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
