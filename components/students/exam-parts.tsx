"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteExamPartAction, saveExamPartAction } from "@/lib/actions/student-results";
import type { ActionResult } from "@/lib/core/action-result";
import type { ExamPart } from "@/lib/students/results";

type Draft = { id?: string; name: string; max: string };

/** The parts of one exam (Paper I / 40, Paper II / 60). */
export function ExamParts({ examId, parts, canEdit }: { examId: string; parts: ExamPart[]; canEdit: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, startTransition] = useTransition();
  const total = parts.reduce((s, p) => s + p.maxMarks, 0);

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
    if (!draft) return;
    const sort = draft.id ? parts.find((p) => p.id === draft.id)?.sortOrder : parts.length;
    run(
      () => saveExamPartAction({ id: draft.id, exam_id: examId, name: draft.name, max_marks: draft.max, sort_order: sort }),
      () => setDraft(null),
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm">Parts:</span>
        {parts.length === 0 && <span className="text-sm">none yet</span>}
        {parts.map((p) => (
          <span key={p.id} className="bg-muted inline-flex items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2 text-sm">
            {p.name} <span className="text-muted-foreground">/ {p.maxMarks}</span>
            {canEdit && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={`Edit ${p.name}`}
                  onClick={() => setDraft({ id: p.id, name: p.name, max: String(p.maxMarks) })}
                >
                  <PencilIcon className="size-3" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-muted-foreground size-6" aria-label={`Remove ${p.name}`}>
                      <Trash2Icon className="size-3" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove {p.name}?</AlertDialogTitle>
                      <AlertDialogDescription>Marks entered for this part are removed too.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" disabled={pending} onClick={() => run(() => deleteExamPartAction({ id: p.id }))}>
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </span>
        ))}
        {parts.length > 1 && <span className="text-muted-foreground text-sm">= {total}</span>}
        {canEdit && !draft && (
          <Button variant="outline" size="sm" onClick={() => setDraft({ name: parts.length ? `Paper ${parts.length + 1}` : "Paper I", max: "" })}>
            <PlusIcon /> Add part
          </Button>
        )}
      </div>
      {draft && (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Part name"
            className="h-8 w-44"
            maxLength={60}
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <Input
            aria-label="Full marks"
            className="h-8 w-24"
            inputMode="decimal"
            placeholder="Out of"
            value={draft.max}
            onChange={(e) => setDraft({ ...draft, max: e.target.value })}
          />
          <Button type="submit" size="sm" disabled={pending || !draft.name.trim() || !draft.max}>
            {pending && <Loader2Icon className="animate-spin" />} Save
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Cancel" onClick={() => setDraft(null)}>
            <XIcon />
          </Button>
        </form>
      )}
    </div>
  );
}

