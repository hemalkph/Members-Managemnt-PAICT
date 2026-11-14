"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  LayersIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
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
import { Textarea } from "@/components/ui/textarea";
import { deleteTaskTypeAction, saveTaskTypeAction } from "@/lib/actions/tasks";
import type { TaskView } from "@/lib/tasks/queries";
import {
  fillTitle,
  FIELD_KINDS,
  MAX_FIELDS,
  newFieldId,
  TASK_COLORS,
  TASK_ICON_NAMES,
  type FieldKind,
  type TaskColor,
  type TaskField,
  type TaskIconName,
  type TaskTypeView,
} from "@/lib/tasks/types";
import { taskWhatsAppText } from "@/lib/tasks/whatsapp";
import { cn } from "@/lib/utils";
import { TaskCard } from "./task-card";
import { TASK_COLOR_CLASSES, TASK_COLOR_SWATCHES, TASK_ICONS, TaskTypeIcon } from "./task-type-icon";
import type { TaskFormOptions } from "./task-dialog";

const NONE = "none";

type DraftField = { key: number; id: string; label: string; kind: FieldKind; required: boolean; optionsText: string };

let nextKey = 1;

/** An example value for a field, for the preview. */
function sampleValue(f: TaskField, today: string): string {
  switch (f.kind) {
    case "link":
      return "https://example.com/your-link";
    case "date":
      return today;
    case "number":
      return "1";
    case "select":
      return f.options[0] ?? "Option";
    case "file":
      return `preview-file-${f.id}`;
    default:
      return f.label ? `Example ${f.label.toLowerCase()}` : "Example";
  }
}

/** The task as the member will see it in My tasks, with example values. */
function previewTask(p: {
  name: string;
  icon: string;
  color: TaskColor;
  instructions: string;
  titleTemplate: string;
  fields: TaskField[];
  dueDays: number | null;
  high: boolean;
  assigneeName: string;
  roleName: string | null;
}): TaskView {
  const today = new Date().toLocaleDateString("en-CA");
  const values = Object.fromEntries(p.fields.map((f) => [f.id, sampleValue(f, today)]));
  const dueDate = p.dueDays === null ? null : new Date(Date.now() + p.dueDays * 86_400_000).toLocaleDateString("en-CA");
  return {
    id: "preview",
    title: (p.titleTemplate && fillTitle(p.titleTemplate, p.fields, values)) || p.name || "Task title",
    description: null,
    assigneeId: "",
    assigneeName: p.assigneeName,
    roleId: null,
    roleName: p.roleName,
    examId: null,
    examLabel: null,
    centreId: null,
    centreName: null,
    quantity: null,
    dueDate,
    dueLabel:
      p.dueDays === null
        ? null
        : p.dueDays === 0
          ? "Due today"
          : p.dueDays === 1
            ? "Due tomorrow"
            : `Due in ${p.dueDays} days`,
    overdue: false,
    dueSoon: p.dueDays !== null && p.dueDays <= 3,
    priority: p.high ? "high" : "normal",
    status: "open",
    paperId: null,
    workCount: 0,
    createdByName: null,
    completedAt: null,
    fixNote: null,
    sentBackAt: null,
    // Example files for "File upload" fields.
    files: p.fields
      .filter((f) => f.kind === "file")
      .map((f) => ({
        id: `preview-file-${f.id}`,
        kind: "brief" as const,
        fileName: `${(f.label || "file").toLowerCase().replace(/\s+/g, "-")}.pdf`,
        sizeBytes: 250_000,
        when: "",
        seen: false,
      })),
    typeId: "preview",
    typeName: p.name || "Task type",
    typeIcon: p.icon || null,
    typeColor: p.color,
    typeInstructions: p.instructions || null,
    details: p.fields.map((f) => ({ id: f.id, label: f.label || "Field", kind: f.kind, value: values[f.id] })),
  };
}

/** "Task types" button: the list of presets, and the editor to add or change one. */
export function TaskTypesButton({ types, options }: { types: TaskTypeView[]; options: TaskFormOptions }) {
  const [open, setOpen] = useState(false);
  // undefined = the list; null = a new type; otherwise the type being edited.
  const [editing, setEditing] = useState<TaskTypeView | null | undefined>(undefined);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <LayersIcon /> Task types
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setEditing(undefined);
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          {editing === undefined ? (
            <TypeList types={types} options={options} onEdit={setEditing} />
          ) : (
            <TypeEditor
              key={editing?.id ?? "new"}
              type={editing}
              options={options}
              onDone={() => setEditing(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TypeList({
  types,
  options,
  onEdit,
}: {
  types: TaskTypeView[];
  options: TaskFormOptions;
  onEdit: (type: TaskTypeView | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const roleName = (id: string | null) => options.roles.find((r) => r.id === id)?.name;
  const memberName = (id: string | null) => options.members.find((m) => m.id === id)?.name;

  const remove = (id: string) =>
    startTransition(async () => {
      const result = await deleteTaskTypeAction({ id });
      setConfirmId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Task types</DialogTitle>
        <DialogDescription>
          Presets for work you give often, with their own fields. Pick one when you assign a task.
        </DialogDescription>
      </DialogHeader>

      {types.length === 0 ? (
        <EmptyState
          icon={LayersIcon}
          title="No task types yet"
          description="For example “Upload recording to LMS” with Title, Lesson and Video URL."
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {types.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
              <TaskTypeIcon icon={t.icon} color={t.color} className="size-9" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {t.name}
                  {!t.active && <Badge variant="secondary">Hidden</Badge>}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {[
                    `${t.fields.length} field${t.fields.length === 1 ? "" : "s"}`,
                    roleName(t.roleId),
                    memberName(t.defaultAssigneeId) && `to ${memberName(t.defaultAssigneeId)}`,
                    t.dueDays !== null &&
                      (t.dueDays === 0 ? "due the same day" : `due in ${t.dueDays} day${t.dueDays === 1 ? "" : "s"}`),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label={`Edit ${t.name}`} onClick={() => onEdit(t)}>
                <PencilIcon />
              </Button>
              {confirmId === t.id ? (
                <Button variant="destructive" size="sm" disabled={pending} onClick={() => remove(t.id)}>
                  {pending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />} Delete
                </Button>
              ) : (
                <Button variant="ghost" size="icon" aria-label={`Delete ${t.name}`} onClick={() => setConfirmId(t.id)}>
                  <Trash2Icon />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirmId && (
        <p className="text-muted-foreground text-xs">
          Press Delete again to remove it. Tasks already given keep their details.
        </p>
      )}

      <DialogFooter>
        <Button onClick={() => onEdit(null)}>
          <PlusIcon /> New task type
        </Button>
      </DialogFooter>
    </div>
  );
}

function TypeEditor({
  type,
  options,
  onDone,
}: {
  type: TaskTypeView | null;
  options: TaskFormOptions;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(type?.name ?? "");
  const [icon, setIcon] = useState<TaskIconName | "">(() =>
    type
      ? (TASK_ICON_NAMES as readonly string[]).includes(type.icon ?? "")
        ? (type.icon as TaskIconName)
        : ""
      : "clapperboard",
  );
  const [color, setColor] = useState<TaskColor>(type?.color ?? "blue");
  const [description, setDescription] = useState(type?.description ?? "");
  const [roleId, setRoleId] = useState(type?.roleId ?? "");
  const [assigneeId, setAssigneeId] = useState(type?.defaultAssigneeId ?? "");
  const [titleTemplate, setTitleTemplate] = useState(type?.titleTemplate ?? "");
  const [dueDays, setDueDays] = useState(
    type?.dueDays === null || type?.dueDays === undefined ? "" : String(type.dueDays),
  );
  const [high, setHigh] = useState(type?.priority === "high");
  const [active, setActive] = useState(type?.active ?? true);
  const [fields, setFields] = useState<DraftField[]>(
    () =>
      type?.fields.map((f) => ({
        key: nextKey++,
        id: f.id,
        label: f.label,
        kind: f.kind,
        required: f.required,
        optionsText: f.options.join("\n"),
      })) ?? [{ key: nextKey++, id: "", label: "Title", kind: "text", required: true, optionsText: "" }],
  );

  const update = (key: number, patch: Partial<DraftField>) =>
    setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const move = (index: number, by: number) =>
    setFields((fs) => {
      const next = [...fs];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const due = dueDays.trim() === "" ? null : Number(dueDays);
    if (due !== null && (!Number.isInteger(due) || due < 0 || due > 90)) {
      toast.error("Due in: a whole number of days (0–90)");
      return;
    }
    // New fields get an id from their name; existing ones keep theirs.
    const taken: string[] = fields.filter((f) => f.id).map((f) => f.id);
    const payload = fields.map((f) => {
      const id = f.id || newFieldId(f.label, taken);
      taken.push(id);
      return {
        id,
        label: f.label,
        kind: f.kind,
        required: f.required,
        options: f.optionsText
          .split("\n")
          .map((o) => o.trim())
          .filter(Boolean),
      };
    });
    startTransition(async () => {
      const result = await saveTaskTypeAction({
        id: type?.id,
        name,
        icon,
        color,
        description,
        role_id: roleId,
        default_assignee_id: assigneeId,
        title_template: titleTemplate,
        due_days: due,
        priority: high ? "high" : "normal",
        active,
        fields: payload,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
      onDone();
    });
  };

  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{type ? `Edit “${type.name}”` : "New task type"}</DialogTitle>
        <DialogDescription>Its fields show in “Assign a task” when you pick it.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor="type-name">Name</Label>
        <div className="flex items-center gap-2">
          <TaskTypeIcon icon={icon || null} color={color} size={20} className="size-9" />
          <Input
            id="type-name"
            value={name}
            maxLength={60}
            placeholder="e.g. Upload recording to LMS"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      <IconPicker
        icon={icon}
        color={color}
        onPick={(next, tileColor) => {
          setIcon(next);
          if (next !== icon) setColor(tileColor);
        }}
        onColor={setColor}
      />

      <div className="grid gap-2">
        <Label htmlFor="type-description">Instructions (optional)</Label>
        <Textarea
          id="type-description"
          rows={2}
          maxLength={300}
          value={description}
          placeholder="Shown on every task of this type"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Usually given to</Label>
          <Select value={assigneeId || NONE} onValueChange={(v) => setAssigneeId(v === NONE ? "" : v)}>
            <SelectTrigger aria-label="Usually given to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Choose each time</SelectItem>
              {options.members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Role</Label>
          <Select value={roleId || NONE} onValueChange={(v) => setRoleId(v === NONE ? "" : v)}>
            <SelectTrigger aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Any role</SelectItem>
              {options.roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="type-due">Due in (days)</Label>
          <Input
            id="type-due"
            type="number"
            inputMode="numeric"
            min={0}
            max={90}
            placeholder="No default"
            value={dueDays}
            onChange={(e) => setDueDays(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="type-title">Task title</Label>
          <Input
            id="type-title"
            value={titleTemplate}
            maxLength={150}
            placeholder="e.g. Upload: {Title}"
            onChange={(e) => setTitleTemplate(e.target.value)}
          />
        </div>
      </div>
      <p className="text-muted-foreground -mt-2 text-xs">
        In the task title, write a field&apos;s name in {"{ }"} to fill it in, e.g. “Upload: {"{Title}"}”.
      </p>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Fields</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={fields.length >= MAX_FIELDS}
            onClick={() =>
              setFields((fs) => [
                ...fs,
                { key: nextKey++, id: "", label: "", kind: "text", required: false, optionsText: "" },
              ])
            }
          >
            <PlusIcon /> Add field
          </Button>
        </div>
        {fields.length === 0 && <p className="text-muted-foreground text-sm">No fields: the task has just a title.</p>}
        <ol className="grid gap-2">
          {fields.map((f, i) => (
            <li key={f.key} className="grid gap-2 rounded-lg border p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
                <Input
                  value={f.label}
                  maxLength={60}
                  placeholder="Field name, e.g. Video URL"
                  aria-label={`Field ${i + 1} name`}
                  onChange={(e) => update(f.key, { label: e.target.value })}
                />
                <Select value={f.kind} onValueChange={(v) => update(f.key, { kind: v as FieldKind })}>
                  <SelectTrigger aria-label={`Field ${i + 1} kind`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FIELD_KINDS) as FieldKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {FIELD_KINDS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move down"
                    disabled={i === fields.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${f.label || "field"}`}
                    onClick={() => setFields((fs) => fs.filter((x) => x.key !== f.key))}
                  >
                    <XIcon />
                  </Button>
                </div>
              </div>
              {f.kind === "select" && (
                <Textarea
                  rows={3}
                  value={f.optionsText}
                  placeholder={"One option per line, e.g.\nNetworking Theory\nNumber Systems"}
                  aria-label={`${f.label || "Dropdown"} options`}
                  onChange={(e) => update(f.key, { optionsText: e.target.value })}
                />
              )}
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={f.required} onCheckedChange={(v) => update(f.key, { required: v })} />
                Required
              </label>
            </li>
          ))}
        </ol>
      </div>

      <Preview
        task={previewTask({
          name,
          icon,
          color,
          instructions: description,
          titleTemplate,
          fields: fields.map((f, i) => ({
            id: f.id || `field_${i}`,
            label: f.label,
            kind: f.kind,
            required: f.required,
            options: f.optionsText
              .split("\n")
              .map((o) => o.trim())
              .filter(Boolean),
          })),
          dueDays: dueDays.trim() === "" || !Number.isInteger(Number(dueDays)) ? null : Number(dueDays),
          high,
          assigneeName: options.members.find((m) => m.id === assigneeId)?.name ?? "the member",
          roleName: options.roles.find((r) => r.id === roleId)?.name ?? null,
        })}
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
          High priority by default
          <Switch checked={high} onCheckedChange={setHigh} />
        </label>
        <label className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
          Show when assigning
          <Switch checked={active} onCheckedChange={setActive} />
        </label>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Back
        </Button>
        <Button type="submit" disabled={pending || name.trim().length < 2 || fields.some((f) => !f.label.trim())}>
          {pending && <Loader2Icon className="animate-spin" />}
          {type ? "Save" : "Add task type"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Live preview: the member's task card and the WhatsApp message, with example values. */
function Preview({ task }: { task: TaskView }) {
  const who = task.assigneeName.split(" ")[0];
  return (
    <section className="grid gap-2" aria-label="Preview">
      <div>
        <p className="text-sm font-medium">Preview</p>
        <p className="text-muted-foreground text-xs">
          What {who === "the" ? "the member sees" : `${who} sees`} in My tasks, with example values. It updates as you
          edit.
        </p>
      </div>
      {/* inert: the buttons are only for show here. */}
      <div inert className="bg-muted/30 rounded-xl border border-dashed p-3">
        <div className="mx-auto max-w-sm">
          <TaskCard task={task} mode="member" />
        </div>
      </div>
      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer text-xs">WhatsApp message they would get</summary>
        <pre className="bg-muted/40 mt-2 overflow-x-auto rounded-lg border p-3 font-sans text-xs whitespace-pre-wrap">
          {taskWhatsAppText(task, typeof window === "undefined" ? "" : window.location.origin)}
        </pre>
      </details>
    </section>
  );
}

const iconLabel = (name: string) => name.replace(/-/g, " ");
// Each tile has its own colour, like a palette; picking a tile takes that colour.
const tileColor = (i: number): TaskColor => TASK_COLORS[i % (TASK_COLORS.length - 1)];

/** Icon & colour: a grid of animated icons on coloured tiles, and colour dots. */
function IconPicker({
  icon,
  color,
  onPick,
  onColor,
}: {
  icon: TaskIconName | "";
  color: TaskColor;
  onPick: (icon: TaskIconName, color: TaskColor) => void;
  onColor: (color: TaskColor) => void;
}) {
  return (
    <fieldset className="grid gap-3">
      <legend className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
        Icon &amp; colour
      </legend>
      <div role="radiogroup" aria-label="Icon" className="grid grid-cols-6 gap-2 sm:grid-cols-9">
        {TASK_ICON_NAMES.map((name, i) => {
          const Icon = TASK_ICONS[name];
          const selected = icon === name;
          const tone = selected ? color : tileColor(i);
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={iconLabel(name)}
              title={iconLabel(name)}
              onClick={() => onPick(name, tileColor(i))}
              className={cn(
                "flex aspect-square items-center justify-center rounded-xl transition-shadow outline-none",
                "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                TASK_COLOR_CLASSES[tone],
                selected && "ring-primary ring-offset-background ring-2 ring-offset-2",
              )}
            >
              <Icon size={20} animateOnHover />
            </button>
          );
        })}
      </div>
      <div role="radiogroup" aria-label="Colour" className="flex flex-wrap items-center gap-2">
        {TASK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={c}
            title={c}
            onClick={() => onColor(c)}
            className={cn(
              "size-6 rounded-full transition-shadow outline-none",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              TASK_COLOR_SWATCHES[c],
              color === c && "ring-foreground ring-offset-background ring-2 ring-offset-2",
            )}
          />
        ))}
      </div>
    </fieldset>
  );
}
