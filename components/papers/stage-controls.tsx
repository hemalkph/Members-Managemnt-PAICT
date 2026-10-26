"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckIcon, Loader2Icon, PencilIcon, SkipForwardIcon } from "lucide-react";
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
import { updatePaperStageAction } from "@/lib/actions/papers";
import { setTaskStatusAction } from "@/lib/actions/tasks";
import type { ActionResult } from "@/lib/action-result";

const NONE = "none";

/** The stage owner finishes their stage (marks the stage task done). */
export function FinishStageButton({ taskId, label }: { taskId: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="success"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setTaskStatusAction({ id: taskId, status: "done" });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(`${label} done – the next stage has started`);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
      Mark my stage done
    </Button>
  );
}

/** Admins: change owner / due date, skip, or mark a stage done. */
export function EditStageDialog({
  paperId,
  stageId,
  label,
  ownerId,
  dueDate,
  status,
  members,
}: {
  paperId: string;
  stageId: string;
  label: string;
  ownerId: string | null;
  dueDate: string | null;
  status: "waiting" | "in_progress" | "done" | "skipped";
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState(ownerId ?? "");
  const [due, setDue] = useState(dueDate ?? "");
  const [pending, startTransition] = useTransition();

  const run = (action: "save" | "skip" | "done") =>
    startTransition(async () => {
      const result: ActionResult = await updatePaperStageAction({
        stage_id: stageId,
        paper_id: paperId,
        owner_id: owner,
        due_date: due,
        action,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOwner(ownerId ?? "");
          setDue(dueDate ?? "");
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PencilIcon /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {status === "skipped"
              ? "This stage is skipped. Choose an owner and save to bring it back."
              : "The owner gets this stage as a task when it starts."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run("save");
          }}
        >
          <div className="grid gap-2">
            <Label>Owner</Label>
            <Select value={owner || NONE} onValueChange={(v) => setOwner(v === NONE ? "" : v)}>
              <SelectTrigger aria-label="Owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No owner yet</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`due-${stageId}`}>Due date</Label>
            <Input id={`due-${stageId}`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="flex gap-2">
              {status !== "done" && status !== "skipped" && (
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run("skip")}>
                  <SkipForwardIcon /> Skip
                </Button>
              )}
              {status === "in_progress" && (
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run("done")}>
                  <CheckIcon /> Mark done
                </Button>
              )}
            </div>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
