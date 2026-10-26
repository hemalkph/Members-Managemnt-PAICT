"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveTaskAction } from "@/lib/actions/tasks";
import type { TaskView } from "@/lib/task-queries";

export type TaskFormOptions = {
  members: { id: string; name: string; roleIds: string[] }[];
  roles: { id: string; name: string }[];
  exams: { id: string; label: string }[];
  centres: { id: string; name: string }[];
};

type State = {
  title: string;
  description: string;
  assignee_id: string;
  role_id: string;
  exam_id: string;
  centre_id: string;
  quantity: string;
  due_date: string;
  high: boolean;
};

const NONE = "none";

function initial(task: TaskView | null): State {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    assignee_id: task?.assigneeId ?? "",
    role_id: task?.roleId ?? "",
    exam_id: task?.examId ?? "",
    centre_id: task?.centreId ?? "",
    quantity: task?.quantity ? String(task.quantity) : "",
    due_date: task?.dueDate ?? "",
    high: task?.priority === "high",
  };
}

/** Admins: assign a new task or edit one. */
export function TaskDialog({
  open,
  onOpenChange,
  task,
  options,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskView | null;
  options: TaskFormOptions;
  today: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>(() => initial(task));
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof State>(key: K, value: State[K]) => setState((s) => ({ ...s, [key]: value }));

  const member = options.members.find((m) => m.id === state.assignee_id);
  // Their roles first, so the right role is easy to pick.
  const roles = member
    ? [...options.roles].sort((a, b) => Number(member.roleIds.includes(b.id)) - Number(member.roleIds.includes(a.id)))
    : options.roles;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const quantity = state.quantity ? Number(state.quantity) : null;
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1)) {
      toast.error("Quantity must be a whole number");
      return;
    }
    startTransition(async () => {
      const result = await saveTaskAction({
        id: task?.id,
        title: state.title,
        description: state.description,
        assignee_id: state.assignee_id,
        role_id: state.role_id,
        exam_id: state.exam_id,
        centre_id: state.centre_id,
        quantity,
        due_date: state.due_date,
        priority: state.high ? "high" : "normal",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{task ? "Edit task" : "Assign a task"}</DialogTitle>
            <DialogDescription>The member is notified and sees it in My tasks.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="task-title">Task</Label>
            <Input
              id="task-title"
              value={state.title}
              maxLength={150}
              placeholder="e.g. Mark Term Test 2 Paper II (Kandy)"
              onChange={(e) => set("title", e.target.value)}
              autoFocus
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Member</Label>
              <Select value={state.assignee_id} onValueChange={(v) => set("assignee_id", v)}>
                <SelectTrigger aria-label="Member">
                  <SelectValue placeholder="Choose a member" />
                </SelectTrigger>
                <SelectContent>
                  {options.members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Role (optional)</Label>
              <Select value={state.role_id || NONE} onValueChange={(v) => set("role_id", v === NONE ? "" : v)}>
                <SelectTrigger aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Any role</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                      {member?.roleIds.includes(r.id) ? " ✓" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Exam / test (optional)</Label>
              <Select value={state.exam_id || NONE} onValueChange={(v) => set("exam_id", v === NONE ? "" : v)}>
                <SelectTrigger aria-label="Exam">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not for an exam</SelectItem>
                  {options.exams.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Class centre (optional)</Label>
              <Select value={state.centre_id || NONE} onValueChange={(v) => set("centre_id", v === NONE ? "" : v)}>
                <SelectTrigger aria-label="Centre">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not for a centre</SelectItem>
                  {options.centres.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                type="date"
                min={task ? undefined : today}
                value={state.due_date}
                onChange={(e) => set("due_date", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-qty">Quantity (optional)</Label>
              <Input
                id="task-qty"
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="e.g. 40 papers"
                value={state.quantity}
                onChange={(e) => set("quantity", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-details">Details (optional)</Label>
            <Textarea
              id="task-details"
              rows={3}
              maxLength={2000}
              value={state.description}
              placeholder="Anything they need to know"
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="task-high">High priority</Label>
              <p className="text-muted-foreground text-xs">Shown in red so it stands out.</p>
            </div>
            <Switch id="task-high" checked={state.high} onCheckedChange={(v) => set("high", v)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || state.title.trim().length < 2 || !state.assignee_id}>
              {pending && <Loader2Icon className="animate-spin" />}
              {task ? "Save" : "Assign task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
