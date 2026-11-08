/** Task types (presets) and their custom fields. Shared by the browser and the server. */

export const FIELD_KINDS = {
  text: "Short text",
  long: "Long text",
  link: "Link",
  date: "Date",
  number: "Number",
  select: "Dropdown",
  file: "File upload",
} as const;
export type FieldKind = keyof typeof FIELD_KINDS;

export const MAX_FIELDS = 20;

/** Animated icons a task type can use (files in components/animate-ui/icons/lucide), in picker order. */
export const TASK_ICON_NAMES = [
  "clapperboard",
  "cloud-upload",
  "upload",
  "book-open",
  "book-text",
  "graduation-cap",
  "file-text",
  "printer",
  "pencil",
  "paintbrush",
  "palette",
  "type",
  "megaphone",
  "message-circle",
  "send",
  "camera",
  "image",
  "mic",
  "link",
  "calendar-check",
  "clipboard-check",
  "folder-open",
  "library-big",
  "notebook-pen",
  "users",
  "wallet",
  "rocket",
  "flame",
  "globe",
  "wifi",
  "lightbulb",
  "sparkles",
  "trophy",
  "star",
  "terminal",
  "layers",
] as const;
export type TaskIconName = (typeof TASK_ICON_NAMES)[number];

export const TASK_COLORS = [
  "blue",
  "sky",
  "emerald",
  "violet",
  "rose",
  "amber",
  "indigo",
  "teal",
  "orange",
  "purple",
  "slate",
] as const;
export type TaskColor = (typeof TASK_COLORS)[number];
export const MAX_OPTIONS = 200;

/** One field of a task type. `id` stays the same when the label is renamed. */
export type TaskField = { id: string; label: string; kind: FieldKind; required: boolean; options: string[] };

/** A filled-in field saved on a task: a copy of the label, so later type edits don't change old tasks. */
export type TaskDetail = { id: string; label: string; kind: FieldKind; value: string };

export type TaskTypeView = {
  id: string;
  name: string;
  icon: string | null;
  color: TaskColor;
  description: string | null;
  roleId: string | null;
  defaultAssigneeId: string | null;
  titleTemplate: string | null;
  dueDays: number | null;
  priority: "normal" | "high";
  fields: TaskField[];
  active: boolean;
};

const LIMIT: Record<FieldKind, number> = {
  text: 200,
  long: 2000,
  link: 2000,
  date: 10,
  number: 20,
  select: 80,
  file: 36,
};

function isLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Checks the values filled in for a type's fields and returns what to save.
 * Empty optional fields are left out. Used on the server for every save.
 * File fields are skipped: their file is uploaded after the task is saved and
 * linked by setTaskFieldFilesAction (which checks the file belongs to the task).
 */
export function checkDetails(
  fields: TaskField[],
  values: Record<string, string>,
): { details: TaskDetail[] } | { error: string } {
  const details: TaskDetail[] = [];
  for (const f of fields) {
    if (f.kind === "file") continue;
    const value = (values[f.id] ?? "").trim();
    if (!value) {
      if (f.required) return { error: `${f.label} is required.` };
      continue;
    }
    if (value.length > LIMIT[f.kind]) return { error: `${f.label} is too long.` };
    let saved = value;
    if (f.kind === "link" && !isLink(value)) return { error: `${f.label}: enter a full link starting with https://` };
    if (f.kind === "date" && !isDate(value)) return { error: `${f.label}: choose a date.` };
    if (f.kind === "number") {
      const n = Number(value);
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { error: `${f.label}: enter a number.` };
      saved = String(n);
    }
    if (f.kind === "select" && !f.options.includes(value)) return { error: `${f.label}: choose one of the options.` };
    details.push({ id: f.id, label: f.label, kind: f.kind, value: saved });
  }
  return { details };
}

/** "Upload: {Title}" with the Title field filled in. Unknown or empty {…} parts are dropped. */
export function fillTitle(template: string, fields: TaskField[], values: Record<string, string>): string {
  return template
    .replace(/\{([^{}]+)\}/g, (_, name: string) => {
      const field = fields.find((f) => f.label.trim().toLowerCase() === name.trim().toLowerCase());
      return field ? (values[field.id] ?? "").trim() : "";
    })
    .replace(/\s{2,}/g, " ")
    .replace(/[\s:–-]+$/, "")
    .trim()
    .slice(0, 150);
}

/** A short, stable id for a new field ("Video URL" → "video_url", "video_url_2" if taken). */
export function newFieldId(label: string, taken: string[]): string {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "field";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`;
  return id;
}

const KINDS = Object.keys(FIELD_KINDS) as FieldKind[];
const isKind = (k: unknown): k is FieldKind => KINDS.includes(k as FieldKind);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A type's fields as stored (JSON), keeping only well-formed ones. */
export function readFields(json: unknown): TaskField[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((f) => {
    if (!f || typeof f !== "object" || !isKind(f.kind) || !str(f.id) || !str(f.label)) return [];
    const options = Array.isArray(f.options) ? f.options.filter((o: unknown) => typeof o === "string") : [];
    return [{ id: f.id, label: f.label, kind: f.kind, required: f.required === true, options }];
  });
}

/** A task's filled-in fields as stored (JSON). */
export function readDetails(json: unknown): TaskDetail[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((d) =>
    d && typeof d === "object" && isKind(d.kind) && str(d.label) && str(d.value)
      ? [{ id: str(d.id), label: d.label, kind: d.kind, value: d.value }]
      : [],
  );
}
