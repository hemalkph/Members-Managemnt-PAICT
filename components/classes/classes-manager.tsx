"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarDaysIcon, GraduationCapIcon, Loader2Icon, MapPinIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
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
import { deleteClassItemAction, saveBatchAction, saveCentreAction, saveExamAction } from "@/lib/actions/classes";
import type { ActionResult } from "@/lib/action-result";
import type { ClassOptions } from "@/lib/classes";
import { formatDate } from "@/lib/format";

type Kind = "batch" | "exam" | "centre";
type Editing = { kind: Kind; id?: string; name: string; batchId: string; examDate: string; isActive: boolean };

const KIND_LABEL: Record<Kind, string> = { batch: "batch", exam: "exam / test", centre: "class centre" };

export function ClassesManager({ options, counts }: { options: ClassOptions; counts: Record<string, number> }) {
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
    const { kind, id, name, batchId, examDate, isActive } = editing;
    run(
      () =>
        kind === "batch"
          ? saveBatchAction({ id, name, is_active: isActive })
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
  });

  const DeleteButton = ({ kind, id, name }: { kind: Kind; id: string; name: string }) => (
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
            {kind === "batch"
              ? "Its exams are deleted too. "
              : ""}
            Work, tasks and papers tagged with it stay, but lose the tag. To hide it from forms but keep the history,
            switch it to inactive instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={() => run(() => deleteClassItemAction({ kind, id }))}>
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
      <Button variant="ghost" size="icon" aria-label={`Edit ${title}`} onClick={onEdit}>
        <PencilIcon />
      </Button>
      {del}
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
            <Button size="sm" variant="outline" onClick={() => setEditing(empty("batch"))}>
              <PlusIcon /> Add
            </Button>
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
              <h2 className="font-semibold">Exams & tests</h2>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={options.batches.length === 0}
              onClick={() => setEditing(empty("exam"))}
            >
              <PlusIcon /> Add
            </Button>
          </div>
          {options.exams.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {options.batches.length === 0 ? "Add a batch first." : "Add tests, e.g. “Term Test 2” or “Model Paper 1”."}
            </p>
          ) : (
            <div className="space-y-3">
              {options.batches
                .filter((b) => options.exams.some((e) => e.batchId === b.id))
                .map((b) => (
                  <div key={b.id}>
                    <p className="text-muted-foreground px-2 text-xs font-semibold tracking-wide uppercase">{b.name}</p>
                    <ul className="space-y-0.5">
                      {options.exams
                        .filter((e) => e.batchId === b.id)
                        .map((e) => (
                          <Row
                            key={e.id}
                            title={e.name}
                            subtitle={e.examDate ? formatDate(e.examDate) : "No date"}
                            active={e.isActive}
                            count={counts[e.id]}
                            onEdit={() =>
                              setEditing({
                                kind: "exam",
                                id: e.id,
                                name: e.name,
                                batchId: e.batchId,
                                examDate: e.examDate ?? "",
                                isActive: e.isActive,
                              })
                            }
                            del={<DeleteButton kind="exam" id={e.id} name={e.name} />}
                          />
                        ))}
                    </ul>
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
            <Button size="sm" variant="outline" onClick={() => setEditing(empty("centre"))}>
              <PlusIcon /> Add
            </Button>
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
                  {editing.kind === "exam"
                    ? "Members tag their marking and paper work with it, so reports can show work per test."
                    : editing.kind === "centre"
                      ? "Where the class or exam happens."
                      : "A group of students, e.g. the 2026 A/L batch."}
                </DialogDescription>
              </DialogHeader>
              {editing.kind === "exam" && (
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
              <div className="grid gap-2">
                <Label htmlFor="class-item-name">Name</Label>
                <Input
                  id="class-item-name"
                  value={editing.name}
                  maxLength={80}
                  autoFocus
                  placeholder={
                    editing.kind === "batch" ? "2026 A/L" : editing.kind === "exam" ? "Term Test 2" : "Kandy hall"
                  }
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              {editing.kind === "exam" && (
                <div className="grid gap-2">
                  <Label htmlFor="class-item-date">Exam date (optional)</Label>
                  <Input
                    id="class-item-date"
                    type="date"
                    value={editing.examDate}
                    onChange={(e) => setEditing({ ...editing, examDate: e.target.value })}
                  />
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label htmlFor="class-item-active">Active</Label>
                  <p className="text-muted-foreground text-xs">Inactive ones are hidden from forms but kept in reports.</p>
                </div>
                <Switch
                  id="class-item-active"
                  checked={editing.isActive}
                  onCheckedChange={(v) => setEditing({ ...editing, isActive: v })}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || editing.name.trim().length < 2}>
                  {pending && <Loader2Icon className="animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
