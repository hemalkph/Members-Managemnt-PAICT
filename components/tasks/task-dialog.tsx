"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Loader2Icon, PaperclipIcon } from "lucide-react";
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
import { saveTaskAction, setTaskFieldFilesAction } from "@/lib/actions/tasks";
import { MAX_TASK_FILE_BYTES } from "@/lib/core/validation";
import type { TaskView } from "@/lib/tasks/queries";
import { fillTitle, type TaskTypeView } from "@/lib/tasks/types";
import { PendingFiles, uploadTaskFiles } from "./task-files";
import { TaskTypeIcon } from "./task-type-icon";

export type TaskFormOptions = {
  members: { id: string; name: string; roleIds: string[] }[];
  roles: { id: string; name: string }[];
  exams: { id: string; label: string }[];
  centres: { id: string; name: string }[];
  /** Task types (presets) and their fields. */
  types: TaskTypeView[];
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
  type_id: string;
  /** Field values by field id. */
  details: Record<string, string>;
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
    type_id: task?.typeId ?? "",
    details: Object.fromEntries((task?.details ?? []).map((d) => [d.id, d.value])),
  };
}

function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
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
  const [files, setFiles] = useState<File[]>([]);
  // Files chosen for the type's "File upload" fields, by field id.
  const [fieldFiles, setFieldFiles] = useState<Record<string, File>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof State>(key: K, value: State[K]) => setState((s) => ({ ...s, [key]: value }));
  // The title follows the type's title pattern until it is typed over.
  const [titleTouched, setTitleTouched] = useState(Boolean(task));
  const type = options.types.find((t) => t.id === state.type_id) ?? null;
  const pickable = options.types.filter((t) => t.active || t.id === state.type_id);

  const chooseType = (id: string) => {
    const next = options.types.find((t) => t.id === id) ?? null;
    setFieldFiles({});
    setState((s) => ({
      ...s,
      type_id: next?.id ?? "",
      details: {},
      // New tasks take the type's defaults; edits keep what was chosen.
      ...(next && !task
        ? {
            assignee_id: next.defaultAssigneeId ?? s.assignee_id,
            role_id: next.roleId ?? s.role_id,
            due_date: next.dueDays !== null ? addDays(today, next.dueDays) : s.due_date,
            high: next.priority === "high",
            title: next.titleTemplate && !titleTouched ? fillTitle(next.titleTemplate, next.fields, {}) : s.title,
          }
        : {}),
    }));
  };

  const setDetail = (id: string, value: string) =>
    setState((s) => {
      const details = { ...s.details, [id]: value };
      const title = type?.titleTemplate && !titleTouched ? fillTitle(type.titleTemplate, type.fields, details) : s.title;
      return { ...s, details, title };
    });

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
    const fileFields = type?.fields.filter((f) => f.kind === "file") ?? [];
    const missing = fileFields.find((f) => f.required && !fieldFiles[f.id] && !state.details[f.id]);
    if (missing) {
      toast.error(`${missing.label}: choose a file.`);
      return;
    }
    const tooBig = Object.values(fieldFiles).find((f) => f.size > MAX_TASK_FILE_BYTES);
    if (tooBig) {
      toast.error(`${tooBig.name} is over 50 MB. Share a link to it instead.`);
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
        type_id: state.type_id,
        details: type ? Object.fromEntries(type.fields.map((f) => [f.id, state.details[f.id] ?? ""])) : {},
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Files for "File upload" fields: upload, then link each to its field.
      const chosen = Object.entries(fieldFiles).filter(([id]) => type?.fields.some((f) => f.id === id));
      if (chosen.length > 0 && result.data) {
        const taskId = result.data.id;
        const upload = await uploadTaskFiles(taskId, "brief", chosen.map(([, file]) => file));
        const linked =
          upload.ok && upload.data
            ? await setTaskFieldFilesAction({
                task_id: taskId,
                files: chosen.map(([field_id], i) => ({ field_id, file_id: upload.data!.ids[i] })),
              })
            : upload;
        if (!linked.ok) {
          toast.error(`${result.message}, but the files weren't attached: ${linked.error}`);
          if (!task) onOpenChange(false);
          router.refresh();
          return;
        }
      }
      if (files.length > 0 && result.data) {
        const upload = await uploadTaskFiles(result.data.id, "brief", files);
        if (!upload.ok) {
          toast.error(`${result.message}, but the files weren't added: ${upload.error}`);
          if (!task) onOpenChange(false);
          router.refresh();
          return;
        }
      }
      toast.success(files.length > 0 ? `${result.message} with ${files.length} file${files.length === 1 ? "" : "s"}` : result.message);
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

          {pickable.length > 0 && (
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={state.type_id || NONE} onValueChange={(v) => chooseType(v === NONE ? "" : v)}>
                <SelectTrigger aria-label="Task type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No type (just a title)</SelectItem>
                  {pickable.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <TaskTypeIcon icon={t.icon} color={t.color} size={14} className="size-6 rounded-md" />
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {type?.description && <p className="text-muted-foreground text-xs whitespace-pre-line">{type.description}</p>}
            </div>
          )}

          {type && type.fields.length > 0 && (
            <div className="bg-muted/40 grid gap-3 rounded-lg border p-3">
              {type.fields.map((f) => {
                const id = `task-field-${f.id}`;
                const value = state.details[f.id] ?? "";
                const label = (
                  <Label htmlFor={id}>
                    {f.label}
                    {!f.required && <span className="text-muted-foreground font-normal"> (optional)</span>}
                  </Label>
                );
                if (f.kind === "file") {
                  const picked = fieldFiles[f.id];
                  const existing = task?.files.find((x) => x.id === state.details[f.id]);
                  return (
                    <div key={f.id} className="grid gap-2">
                      {label}
                      <div className="flex min-w-0 items-center gap-2">
                        <Button type="button" variant="outline" size="sm" asChild>
                          <label htmlFor={id} className="cursor-pointer">
                            <PaperclipIcon /> {picked || existing ? "Replace file" : "Choose file"}
                          </label>
                        </Button>
                        <span className="text-muted-foreground min-w-0 truncate text-sm">
                          {picked?.name ?? existing?.fileName ?? "No file yet"}
                        </span>
                        <input
                          id={id}
                          type="file"
                          className="sr-only"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setFieldFiles((ff) => ({ ...ff, [f.id]: file }));
                            e.target.value = "";
                          }}
                        />
                      </div>
                    </div>
                  );
                }
                if (f.kind === "select") {
                  return (
                    <div key={f.id} className="grid gap-2">
                      {label}
                      <Select value={value || undefined} onValueChange={(v) => setDetail(f.id, v)}>
                        <SelectTrigger id={id}>
                          <SelectValue placeholder={`Choose ${f.label.toLowerCase()}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {f.options.map((o) => (
                            <SelectItem key={o} value={o}>
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }
                return (
                  <div key={f.id} className="grid gap-2">
                    {label}
                    {f.kind === "long" ? (
                      <Textarea id={id} rows={3} maxLength={2000} value={value} onChange={(e) => setDetail(f.id, e.target.value)} />
                    ) : (
                      <Input
                        id={id}
                        type={f.kind === "link" ? "url" : f.kind === "date" ? "date" : f.kind === "number" ? "number" : "text"}
                        inputMode={f.kind === "link" ? "url" : f.kind === "number" ? "decimal" : undefined}
                        placeholder={f.kind === "link" ? "https://" : undefined}
                        maxLength={f.kind === "link" ? 2000 : 200}
                        value={value}
                        onChange={(e) => setDetail(f.id, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="task-title">Task</Label>
            <Input
              id="task-title"
              value={state.title}
              maxLength={150}
              placeholder="e.g. Mark Term Test 2 Paper II (Kandy)"
              onChange={(e) => {
                setTitleTouched(true);
                set("title", e.target.value);
              }}
              autoFocus={!type}
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

          <div className="grid gap-2">
            <Label>{task ? "Add files (optional)" : "Files for the member (optional)"}</Label>
            <PendingFiles files={files} onRemove={(i) => setFiles((f) => f.filter((_, j) => j !== i))} />
            <Button type="button" variant="outline" className="border-dashed" onClick={() => fileInput.current?.click()}>
              <PaperclipIcon /> Choose files
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              aria-label="Choose files"
              onChange={(e) => {
                const chosen = Array.from(e.target.files ?? []);
                setFiles((f) => [...f, ...chosen]);
                e.target.value = "";
              }}
            />
            <p className="text-muted-foreground text-xs">
              {task ? "They show as new files for the member." : "e.g. type setting or design material. Up to 50 MB each."}
            </p>
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
