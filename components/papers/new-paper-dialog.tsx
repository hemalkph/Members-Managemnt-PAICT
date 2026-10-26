"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FilePlus2Icon, Loader2Icon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { createPaperAction } from "@/lib/actions/papers";
import type { PaperStageName } from "@/lib/database.types";
import { STAGES } from "@/lib/papers";
import { cn } from "@/lib/utils";

type StageState = { stage: PaperStageName; owner_id: string; due_date: string; skip: boolean };
const NONE = "none";

/** Admins: add a paper or tute and plan who does each stage. */
export function NewPaperDialog({
  members,
  exams,
  defaultExam,
  today,
}: {
  members: { id: string; name: string }[];
  exams: { id: string; label: string }[];
  defaultExam?: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"paper" | "tute">("paper");
  const [examId, setExamId] = useState(defaultExam ?? "");
  const [notes, setNotes] = useState("");
  const [stages, setStages] = useState<StageState[]>(
    STAGES.map((s) => ({ stage: s.stage, owner_id: "", due_date: "", skip: false })),
  );
  const [pending, startTransition] = useTransition();

  const setStage = (i: number, patch: Partial<StageState>) =>
    setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const reset = () => {
    setTitle("");
    setKind("paper");
    setExamId(defaultExam ?? "");
    setNotes("");
    setStages(STAGES.map((s) => ({ stage: s.stage, owner_id: "", due_date: "", skip: false })));
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (stages.every((s) => s.skip)) {
      toast.error("Keep at least one stage");
      return;
    }
    startTransition(async () => {
      const result = await createPaperAction({ title, kind, exam_id: examId, notes, stages });
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Could not add the paper." : result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      reset();
      router.push(`/papers/${result.data.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FilePlus2Icon /> New paper
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New paper or tute</DialogTitle>
            <DialogDescription>
              Choose who does each stage. Each owner gets it as a task when the stage before is done.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <div className="grid gap-2">
              <Label htmlFor="paper-title">Title</Label>
              <Input
                id="paper-title"
                value={title}
                maxLength={150}
                autoFocus
                placeholder="e.g. Term Test 2 – Paper I (MCQ)"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as "paper" | "tute")}>
                <SelectTrigger aria-label="Type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paper">Paper</SelectItem>
                  <SelectItem value="tute">Tute</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Exam / test</Label>
            <Select value={examId || NONE} onValueChange={(v) => setExamId(v === NONE ? "" : v)}>
              <SelectTrigger aria-label="Exam">
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

          <div className="space-y-2">
            <p className="text-sm font-medium">Stages</p>
            <div className="divide-y rounded-lg border">
              {STAGES.map((s, i) => {
                const st = stages[i];
                return (
                  <div key={s.stage} className={cn("grid gap-2 p-3 sm:grid-cols-[150px_1fr_150px_auto] sm:items-center", st.skip && "bg-muted/40")}>
                    <div>
                      <p className={cn("text-sm font-medium", st.skip && "text-muted-foreground line-through")}>
                        {i + 1}. {s.label}
                      </p>
                      <p className="text-muted-foreground text-xs">{s.description}</p>
                    </div>
                    <Select
                      value={st.owner_id || NONE}
                      disabled={st.skip}
                      onValueChange={(v) => setStage(i, { owner_id: v === NONE ? "" : v })}
                    >
                      <SelectTrigger aria-label={`${s.label} owner`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Choose later</SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="date"
                      aria-label={`${s.label} due date`}
                      min={today}
                      value={st.due_date}
                      disabled={st.skip}
                      onChange={(e) => setStage(i, { due_date: e.target.value })}
                    />
                    <label className="flex items-center gap-2 text-xs">
                      <Switch checked={st.skip} onCheckedChange={(v) => setStage(i, { skip: v })} aria-label={`Skip ${s.label}`} />
                      Skip
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="paper-notes">Notes (optional)</Label>
            <Textarea
              id="paper-notes"
              rows={2}
              maxLength={1000}
              value={notes}
              placeholder="e.g. 50 MCQ + 6 structured, A4, Sinhala and English medium"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || title.trim().length < 2}>
              {pending && <Loader2Icon className="animate-spin" />}
              Add paper
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
