"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CalendarDaysIcon,
  GraduationCapIcon,
  Layers3Icon,
  Loader2Icon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  deleteClassItemAction,
  nextSeriesExamAction,
  saveBatchAction,
  saveCentreAction,
  saveExamAction,
  saveSeriesAction,
} from "@/lib/actions/classes";
import type { ActionResult } from "@/lib/core/action-result";
import type { ClassOptions } from "@/lib/organisation/classes";
import { formatDate } from "@/lib/core/format";
import { groupExams } from "@/lib/organisation/exam-groups";

type Kind = "batch" | "series" | "exam" | "next" | "centre";
type PartRow = { name: string; max_marks: string };
type Editing = {
  kind: Kind;
  id?: string;
  name: string;
  batchId: string;
  examDate: string;
  isActive: boolean;
  /** Series: short code and the parts of every exam. */
  code: string;
  parts: PartRow[];
};

const KIND_LABEL: Record<Kind, string> = {
  batch: "batch",
  series: "exam series",
  exam: "exam / test",
  next: "next exam",
  centre: "class centre",
};
const STARTER_PARTS: PartRow[] = [
  { name: "MCQ", max_marks: "50" },
  { name: "SE & Essay", max_marks: "100" },
];

export function ClassesManager({
  options,
  counts,
  parts = {},
  readOnly = false,
}: {
  options: ClassOptions;
  counts: Record<string, number>;
  /** exam id -> "MCQ /50 · SE & Essay /100" */
  parts?: Record<string, string>;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      after?.();
      router.refresh();
    });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const { kind, id, name, batchId, examDate, isActive, code, parts: partRows } = editing;
    run(
      () =>
        kind === "batch"
          ? saveBatchAction({ id, name, is_active: isActive })
          : kind === "series"
            ? saveSeriesAction({
                id,
                batch_id: batchId,
                name,
                code,
                default_parts: partRows
                  .filter((p) => p.name.trim())
                  .map((p) => ({ name: p.name, max_marks: p.max_marks })),
                is_active: isActive,
              })
            : kind === "next"
              ? nextSeriesExamAction({ series_id: id ?? "", exam_date: examDate })
              : kind === "exam"
                ? saveExamAction({ id, batch_id: batchId, name, exam_date: examDate, is_active: isActive })
                : saveCentreAction({ id, name, is_active: isActive }),
      () => setEditing(null),
    );
  };

  const empty = (kind: Kind, batchId = options.batches[0]?.id ?? ""): Editing => ({
    kind,
    name: "",
    batchId,
    examDate: "",
    isActive: true,
    code: "",
    parts: kind === "series" ? STARTER_PARTS : [],
  });

  const DeleteButton = ({
    kind,
    id,
    name,
  }: {
    kind: "batch" | "series" | "exam" | "centre";
    id: string;
    name: string;
  }) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Delete ${name}`} className="text-muted-foreground">
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {kind === "series"
              ? "Only a series with no exams left can be deleted. To stop using it but keep its exams, switch it to inactive instead."
              : `${kind === "batch" ? "Its series and exams are deleted too. " : ""}Work, tasks and papers tagged with it stay, but lose the tag. To hide it from forms but keep the history, switch it to inactive instead.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => run(() => deleteClassItemAction({ kind, id }))}
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const Row = ({
    title,
    subtitle,
    active,
    count,
    onEdit,
    del,
  }: {
    title: string;
    subtitle?: string;
    active: boolean;
    count?: number;
    onEdit: () => void;
    del: React.ReactNode;
  }) => (
    <li className="hover:bg-accent/40 flex items-center gap-2 rounded-lg px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {subtitle && <p className="text-muted-foreground truncate text-xs">{subtitle}</p>}
      </div>
      {count !== undefined && count > 0 && (
        <Badge variant="outline" className="hidden sm:inline-flex">
          {count} work
        </Badge>
      )}
      {!active && <Badge variant="secondary">Inactive</Badge>}
      {!readOnly && (
        <>
          <Button variant="ghost" size="icon" aria-label={`Edit ${title}`} onClick={onEdit}>
            <PencilIcon />
          </Button>
          {del}
        </>
      )}
    </li>
  );

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Batches */}
        <SpotlightCard className="space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <GraduationCapIcon className="text-primary size-5" />
              <h2 className="font-semibold">Batches</h2>
            </div>
            {!readOnly && (
              <Button size="sm" variant="outline" onClick={() => setEditing(empty("batch"))}>
                <PlusIcon /> Add
              </Button>
            )}
          </div>
          {options.batches.length === 0 ? (
            <p className="text-muted-foreground text-sm">Add your A/L batches, e.g. “2026 A/L”.</p>
          ) : (
            <ul className="space-y-0.5">
              {options.batches.map((b) => (
                <Row
                  key={b.id}
                  title={b.name}
                  subtitle={`${options.exams.filter((e) => e.batchId === b.id).length} exams`}
                  active={b.isActive}
                  onEdit={() => setEditing({ ...empty("batch"), id: b.id, name: b.name, isActive: b.isActive })}
                  del={<DeleteButton kind="batch" id={b.id} name={b.name} />}
                />
              ))}
            </ul>
          )}
        </SpotlightCard>

        {/* Exams */}
        <SpotlightCard className="space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarDaysIcon className="text-primary size-5" />
              <h2 className="font-semibold">Exams</h2>
            </div>
            {!readOnly && (
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={options.batches.length === 0}
                  onClick={() => setEditing(empty("series"))}
                >
                  <PlusIcon /> Series
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={options.batches.length === 0}
                  onClick={() => setEditing(empty("exam"))}
                >
                  <PlusIcon /> Test
                </Button>
              </div>
            )}
          </div>
          {options.exams.length === 0 && options.series.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {options.batches.length === 0
                ? "Add a batch first."
                : "Add a series for numbered papers (e.g. Ranking Full Papers → RFP 01, 02, …), or a single test."}
            </p>
          ) : (
            <div className="space-y-4">
              {options.batches
                .filter(
                  (b) =>
                    options.exams.some((e) => e.batchId === b.id) || options.series.some((x) => x.batchId === b.id),
                )
                .map((b) => (
                  <div key={b.id} className="space-y-2">
                    <p className="text-muted-foreground px-2 text-xs font-semibold tracking-wide uppercase">{b.name}</p>
                    {groupExams(b.id, options.series, options.exams).map((g) => {
                      const series = options.series.find((x) => x.id === g.seriesId);
                      return (
                        <div key={g.seriesId ?? "other"} className="rounded-lg border p-1.5">
                          <div className="flex items-center gap-2 px-2 py-1">
                            <Layers3Icon className="text-muted-foreground size-4 shrink-0" />
                            <p className="min-w-0 flex-1 truncate text-sm font-semibold">{g.label}</p>
                            {series && !series.isActive && <Badge variant="secondary">Inactive</Badge>}
                            {series && !readOnly && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7"
                                  disabled={!series.isActive}
                                  onClick={() =>
                                    setEditing({ ...empty("next", b.id), id: series.id, name: series.name })
                                  }
                                >
                                  <PlusIcon /> Next exam
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Edit ${series.name}`}
                                  onClick={() =>
                                    setEditing({
                                      ...empty("series", b.id),
                                      id: series.id,
                                      name: series.name,
                                      code: series.code,
                                      isActive: series.isActive,
                                      parts: series.defaultParts.map((p) => ({
                                        name: p.name,
                                        max_marks: String(p.max_marks),
                                      })),
                                    })
                                  }
                                >
                                  <PencilIcon />
                                </Button>
                                <DeleteButton kind="series" id={series.id} name={series.name} />
                              </>
                            )}
                          </div>
                          {g.exams.length === 0 ? (
                            <p className="text-muted-foreground px-2 pb-1 text-xs">No exams yet. Use “Next exam”.</p>
                          ) : (
                            <ul className="space-y-0.5">
                              {g.exams.map((e) => (
                                <Row
                                  key={e.id}
                                  title={e.name}
                                  subtitle={[e.examDate ? formatDate(e.examDate) : "No date", parts[e.id]]
                                    .filter(Boolean)
                                    .join(" · ")}
                                  active={e.isActive}
                                  count={counts[e.id]}
                                  onEdit={() =>
                                    setEditing({
                                      ...empty("exam", e.batchId),
                                      id: e.id,
                                      name: e.name,
                                      examDate: e.examDate ?? "",
                                      isActive: e.isActive,
                                    })
                                  }
                                  del={<DeleteButton kind="exam" id={e.id} name={e.name} />}
                                />
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
            </div>
          )}
        </SpotlightCard>

        {/* Centres */}
        <SpotlightCard className="space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MapPinIcon className="text-primary size-5" />
              <h2 className="font-semibold">Class centres</h2>
            </div>
            {!readOnly && (
              <Button size="sm" variant="outline" onClick={() => setEditing(empty("centre"))}>
                <PlusIcon /> Add
              </Button>
            )}
          </div>
          {options.centres.length === 0 ? (
            <p className="text-muted-foreground text-sm">Add where classes happen, e.g. “Kandy hall” or “Online”.</p>
          ) : (
            <ul className="space-y-0.5">
              {options.centres.map((c) => (
                <Row
                  key={c.id}
                  title={c.name}
                  active={c.isActive}
                  count={counts[c.id]}
                  onEdit={() => setEditing({ ...empty("centre"), id: c.id, name: c.name, isActive: c.isActive })}
                  del={<DeleteButton kind="centre" id={c.id} name={c.name} />}
                />
              ))}
            </ul>
          )}
        </SpotlightCard>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          {editing && (
            <form onSubmit={save} className="grid gap-4">
              <DialogHeader>
                <DialogTitle>
                  {editing.id ? "Edit" : "Add"} {KIND_LABEL[editing.kind]}
                </DialogTitle>
                <DialogDescription>
                  {editing.kind === "series"
                    ? "Numbered papers that come again and again, e.g. Ranking Full Papers (RFP) → RFP 01, RFP 02, … Every exam gets the parts below."
                    : editing.kind === "next"
                      ? `Adds the next ${editing.name} exam with its parts. Papers, tasks, work and results then use it.`
                      : editing.kind === "exam"
                        ? "Members tag their marking and paper work with it, so reports can show work per test."
                        : editing.kind === "centre"
                          ? "Where the class or exam happens."
                          : "A group of students, e.g. the 2026 A/L batch."}
                </DialogDescription>
              </DialogHeader>
              {(editing.kind === "series" ? !editing.id : editing.kind === "exam") && (
                <div className="grid gap-2">
                  <Label>Batch</Label>
                  <Select value={editing.batchId} onValueChange={(v) => setEditing({ ...editing, batchId: v })}>
                    <SelectTrigger aria-label="Batch">
                      <SelectValue placeholder="Choose a batch" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.batches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {editing.kind !== "next" && (
                <div className="grid gap-2">
                  <Label htmlFor="class-item-name">Name</Label>
                  <Input
                    id="class-item-name"
                    value={editing.name}
                    maxLength={80}
                    autoFocus
                    placeholder={
                      editing.kind === "batch"
                        ? "2026 A/L"
                        : editing.kind === "series"
                          ? "Ranking Full Papers"
                          : editing.kind === "exam"
                            ? "Term Test 2"
                            : "Kandy hall"
                    }
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </div>
              )}
              {editing.kind === "series" && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="class-item-code">Short code</Label>
                    <Input
                      id="class-item-code"
                      value={editing.code}
                      maxLength={12}
                      placeholder="RFP"
                      className="uppercase"
                      onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                    />
                    <p className="text-muted-foreground text-xs">
                      Exams are named with it: {editing.code.trim() || "RFP"} 01, {editing.code.trim() || "RFP"} 02, …
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label>Parts of each exam</Label>
                    {editing.parts.map((p, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          aria-label={`Part ${i + 1} name`}
                          value={p.name}
                          maxLength={60}
                          placeholder="MCQ"
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              parts: editing.parts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                            })
                          }
                        />
                        <Input
                          aria-label={`Part ${i + 1} full marks`}
                          value={p.max_marks}
                          inputMode="decimal"
                          className="w-24"
                          placeholder="Marks"
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              parts: editing.parts.map((x, j) => (j === i ? { ...x, max_marks: e.target.value } : x)),
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove part ${i + 1}`}
                          onClick={() => setEditing({ ...editing, parts: editing.parts.filter((_, j) => j !== i) })}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    ))}
                    {editing.parts.length < 6 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="justify-self-start"
                        onClick={() =>
                          setEditing({ ...editing, parts: [...editing.parts, { name: "", max_marks: "" }] })
                        }
                      >
                        <PlusIcon /> Add part
                      </Button>
                    )}
                    <p className="text-muted-foreground text-xs">
                      New exams get these parts. Exams already added keep theirs (change them in Student results).
                    </p>
                  </div>
                </>
              )}
              {(editing.kind === "exam" || editing.kind === "next") && (
                <div className="grid gap-2">
                  <Label htmlFor="class-item-date">
                    {editing.kind === "next" ? "Date of the first paper (optional)" : "Exam date (optional)"}
                  </Label>
                  <Input
                    id="class-item-date"
                    type="date"
                    value={editing.examDate}
                    onChange={(e) => setEditing({ ...editing, examDate: e.target.value })}
                  />
                </div>
              )}
              {editing.kind !== "next" && (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label htmlFor="class-item-active">Active</Label>
                    <p className="text-muted-foreground text-xs">
                      Inactive ones are hidden from forms but kept in reports.
                    </p>
                  </div>
                  <Switch
                    id="class-item-active"
                    checked={editing.isActive}
                    onCheckedChange={(v) => setEditing({ ...editing, isActive: v })}
                  />
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    pending || editing.name.trim().length < 2 || (editing.kind === "series" && !editing.code.trim())
                  }
                >
                  {pending && <Loader2Icon className="animate-spin" />}
                  {editing.kind === "next" ? "Add exam" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
