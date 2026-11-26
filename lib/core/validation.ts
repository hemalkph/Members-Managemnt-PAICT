import { z } from "zod";
import { DRIVE_FILE_ID } from "@/lib/work/drive-videos";
import {
  MAX_FIELDS as MAX_TASK_FIELDS,
  MAX_OPTIONS as MAX_TASK_FIELD_OPTIONS,
  TASK_COLORS,
  TASK_ICON_NAMES,
} from "@/lib/tasks/types";
import { parseNic } from "@/lib/members/nic";

// Shared by client forms (react-hook-form) and Server Actions.
// The server ALWAYS re-validates with these schemas.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_ATTACHMENTS = 10;
export const MAX_LINKS = 10;
export const MAX_DRIVE_VIDEOS = 50;

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be at most ${max} characters`);

const phone = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || /^\+?[0-9][0-9 -]{7,17}$/.test(v), `Enter a valid ${label}`);

const NIC_MESSAGE = "Enter a valid NIC (e.g. 200212345678 or 991234567V)";

const nic = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === "" || parseNic(v) !== null, NIC_MESSAGE);

const requiredNic = z.string().trim().toUpperCase().min(1, "NIC is required").refine((v) => parseNic(v) !== null, NIC_MESSAGE);

const requiredPhone = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((v) => /^\+?[0-9][0-9 -]{7,17}$/.test(v), `Enter a valid ${label.toLowerCase()}`);

export const uuid = z.uuid("Invalid id");
export const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month");
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

// ---------------------------------------------------------------- auth
export const loginSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase(),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ---------------------------------------------------------------- profile
// Members must fill in every field (a complete profile is required to log work).
export const profileSchema = z.object({
  full_name: trimmed(2, 120, "Full name"),
  phone: requiredPhone("Phone number"),
  whatsapp: requiredPhone("WhatsApp number"),
  nic: requiredNic,
});
export type ProfileInput = z.input<typeof profileSchema>;

export const avatarSchema = z.object({
  path: z.string().min(1).max(300),
});

// ---------------------------------------------------------------- bank
export const bankSchema = z.object({
  bank_name: trimmed(2, 80, "Bank name"),
  branch: trimmed(2, 80, "Branch"),
  account_holder: trimmed(2, 120, "Account holder name"),
  // Empty means "keep the saved number" when editing.
  account_number: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .refine((v) => v === "" || /^[0-9]{4,20}$/.test(v), "Account number must be 4–20 digits"),
});
export type BankInput = z.input<typeof bankSchema>;

// ---------------------------------------------------------------- submissions
export const attachmentInputSchema = z.object({
  storage_path: z.string().min(3).max(400),
  file_name: z.string().trim().min(1).max(200),
  mime_type: z.string().max(150).nullable(),
  size_bytes: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES, "Each file must be 10 MB or smaller"),
});
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

export const submissionSchema = z.object({
  work_month: monthKey,
  role_id: z.uuid("Choose one of your roles"),
  /** Work type (rate category). Required when the role has rates; "" = none. */
  rate_item_id: z.union([z.uuid(), z.literal("")]),
  title: trimmed(2, 150, "Title"),
  description: optionalText(2000, "Description"),
  quantity: z
    .number({ error: "Enter a number" })
    .int("Use a whole number")
    .min(1, "Must be at least 1")
    .max(100000, "That number is too large"),
  date_done: isoDate,
  links: z
    .array(z.object({ url: z.url({ protocol: /^https?$/, error: "Enter a full link starting with https://" }) }))
    .max(MAX_LINKS, `Up to ${MAX_LINKS} links`),
  /** Optional tags: which exam/test and class centre, and the task it was for. */
  exam_id: z.union([z.uuid(), z.literal("")]).default(""),
  centre_id: z.union([z.uuid(), z.literal("")]).default(""),
  task_id: z.union([z.uuid(), z.literal("")]).default(""),
});
export type SubmissionInput = z.input<typeof submissionSchema>;

export const submissionActionSchema = submissionSchema.extend({
  attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS, `Up to ${MAX_ATTACHMENTS} files`),
  removed_attachment_ids: z.array(uuid).max(50).default([]),
  /** Google Drive videos the member picked (video roles): the full list for this entry. */
  drive_videos: z
    .array(z.string().regex(DRIVE_FILE_ID, "Invalid video"))
    .max(MAX_DRIVE_VIDEOS, `Up to ${MAX_DRIVE_VIDEOS} videos per entry`)
    .default([]),
});

/** Paper work draft: only the page count is entered. */
export const paperPagesSchema = z.object({
  task_id: uuid,
  pages: z.number({ error: "Enter the number of pages" }).int("Use a whole number").min(1, "At least 1 page").max(2000, "That's too many pages"),
});

// ---------------------------------------------------------------- review
export const reviewSchema = z
  .object({
    /** Each submission with the "last updated" time the reviewer saw: changed ones are skipped. */
    items: z
      .array(z.object({ id: uuid, seen: z.string().min(1).max(64) }))
      .min(1, "Select at least one submission")
      .max(200),
    decision: z.enum(["approved", "rejected", "pending"]),
    comment: optionalText(1000, "Comment"),
  })
  .refine((v) => v.decision !== "rejected" || v.comment.length > 0, {
    message: "Please add a comment explaining why it was rejected",
    path: ["comment"],
  });
export type ReviewInput = z.input<typeof reviewSchema>;
export const reviewLimitSchema = z
  .number({ error: "Enter the number of hours" })
  .int("Use a whole number of hours")
  .min(1, "Pick between 1 and 168 hours")
  .max(168, "Pick between 1 and 168 hours");

// ---------------------------------------------------------------- members (admin)
const memberBase = z.object({
  full_name: trimmed(2, 120, "Full name"),
  phone: phone("phone number"),
  whatsapp: phone("WhatsApp number"),
  nic,
  role_ids: z.array(uuid).max(50),
  is_admin: z.boolean(),
  /** Paid from this month, or from next month (salary and work wait until then). */
  pay_start: z.enum(["this", "next"]).optional(),
});

export const memberCreateSchema = memberBase
  .extend({
    email: z.email("Enter a valid email").trim().toLowerCase(),
    mode: z.enum(["invite", "password"]),
    password: z.string(),
  })
  .refine((v) => v.mode === "invite" || (v.password.length >= 8 && v.password.length <= 72), {
    message: "Temporary password must be 8–72 characters",
    path: ["password"],
  });
export type MemberCreateInput = z.input<typeof memberCreateSchema>;

export const memberUpdateSchema = memberBase.extend({
  id: uuid,
  /** Page access choices (only saved when a main admin edits). Unknown pages are ignored. */
  page_access: z.record(z.string().max(40), z.enum(["edit", "view", "none"])).optional(),
});
export type MemberUpdateInput = z.input<typeof memberUpdateSchema>;

export const memberActiveSchema = z.object({ id: uuid, active: z.boolean() });

/** Admin-set password: at least 8 characters with upper case, lower case and a number. */
export const strongPassword = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(72, "Use at most 72 characters")
  .regex(/[A-Z]/, "Add an upper-case letter")
  .regex(/[a-z]/, "Add a lower-case letter")
  .regex(/[0-9]/, "Add a number");

export const adminResetPasswordSchema = z
  .object({ id: uuid, password: strongPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });
export type AdminResetPasswordInput = z.input<typeof adminResetPasswordSchema>;

// ---------------------------------------------------------------- sections & roles (admin)
export const sectionSchema = z.object({
  id: uuid.optional(),
  name: trimmed(2, 60, "Section name"),
  description: optionalText(300, "Description"),
});
export type SectionInput = z.input<typeof sectionSchema>;

export const roleSchema = z.object({
  id: uuid.optional(),
  section_id: uuid,
  name: trimmed(2, 60, "Role name"),
  description: optionalText(300, "Description"),
});
export type RoleInput = z.input<typeof roleSchema>;

export const idSchema = z.object({ id: uuid });

// ---------------------------------------------------------------- pay rates (admin)
export const MAX_RATE = 10_000_000;

export const rateItemSchema = z.object({
  id: uuid.optional(),
  name: trimmed(1, 60, "Item name"),
  unit: trimmed(1, 20, "Unit"),
  price: z
    .number({ error: "Enter a price" })
    .min(0, "Price can't be negative")
    .max(MAX_RATE, "That price is too large")
    .refine((v) => Math.round(v * 100) === v * 100, "Use at most 2 decimal places"),
});

export const roleRatesSchema = z
  .object({
    role_id: uuid,
    is_salaried: z.boolean(),
    items: z.array(rateItemSchema).max(50, "Up to 50 items per role"),
    /** Monthly salaries for members of a salaried role. */
    salaries: z
      .array(
        z.object({
          user_id: uuid,
          amount: z
            .number({ error: "Enter a salary" })
            .min(0, "Salary can't be negative")
            .max(MAX_RATE, "That salary is too large")
            .refine((v) => Math.round(v * 100) === v * 100, "Use at most 2 decimal places"),
          /** The pay month the amount starts from. */
          from: z.enum(["this", "next"]).default("this"),
        }),
      )
      .max(200)
      .default([]),
  })
  .refine((v) => new Set(v.items.map((i) => i.name.trim().toLowerCase())).size === v.items.length, {
    message: "Each item in a role needs a different name",
    path: ["items"],
  });
export type RoleRatesInput = z.input<typeof roleRatesSchema>;

/** Flatten Zod errors for ActionResult.fieldErrors. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form.";
}

// ---------------------------------------------------------------- notice board (admin)
export const announcementSchema = z.object({
  id: uuid.optional(),
  title: trimmed(2, 120, "Title"),
  body: optionalText(2000, "Message"),
  pinned: z.boolean(),
  expires_on: z.union([isoDate, z.literal("")]),
});
export type AnnouncementInput = z.input<typeof announcementSchema>;

// ---------------------------------------------------------------- payments (main admins)
export const closeMonthSchema = z.object({
  month: monthKey,
  note: optionalText(500, "Note"),
});
export type CloseMonthInput = z.input<typeof closeMonthSchema>;

export const reopenMonthSchema = z.object({ month: monthKey });

export const markPaidSchema = z
  .object({
    ids: z.array(uuid).min(1, "Choose at least one member").max(500),
    paid: z.boolean(),
    paid_on: z.union([isoDate, z.literal("")]),
    reference: optionalText(100, "Reference"),
  })
  .refine((v) => !v.paid || v.paid_on !== "", { message: "Choose the date it was paid", path: ["paid_on"] });
export type MarkPaidInput = z.input<typeof markPaidSchema>;

// ---------------------------------------------------------------- two-step login
export const otpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, "Enter the 6-digit code from your authenticator app"),
});
export type OtpCodeInput = z.input<typeof otpCodeSchema>;

export const confirmTwoStepSchema = otpCodeSchema.extend({ factorId: z.string().min(1).max(100) });

// ---------------------------------------------------------------- notifications
export const notificationIdsSchema = z.object({
  ids: z.array(z.number().int().positive()).max(200).optional(),
});

// ---------------------------------------------------------------- batches, exams, centres (admins)
export const batchSchema = z.object({
  id: uuid.optional(),
  name: trimmed(2, 60, "Batch name"),
  is_active: z.boolean(),
});
export type BatchInput = z.input<typeof batchSchema>;

export const examSchema = z.object({
  id: uuid.optional(),
  batch_id: z.uuid("Choose a batch"),
  name: trimmed(2, 80, "Exam name"),
  exam_date: z.union([isoDate, z.literal("")]),
  is_active: z.boolean(),
});
export type ExamInput = z.input<typeof examSchema>;

/** An exam series, e.g. "Ranking Full Papers" (RFP), with the parts each of its exams has. */
export const examSeriesSchema = z.object({
  id: uuid.optional(),
  batch_id: z.uuid("Choose a batch"),
  name: trimmed(2, 80, "Series name"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,11}$/, "Short code: letters and numbers, up to 12 (e.g. RFP)"),
  default_parts: z
    .array(
      z.object({
        name: trimmed(1, 60, "Part name"),
        max_marks: z.coerce.number("Full marks must be a number").gt(0, "Full marks must be more than 0").max(1000),
      }),
    )
    .max(6, "At most 6 parts")
    .refine((parts) => new Set(parts.map((p) => p.name.toLowerCase())).size === parts.length, "Two parts have the same name"),
  is_active: z.boolean(),
});
export type ExamSeriesInput = z.input<typeof examSeriesSchema>;

export const centreSchema = z.object({
  id: uuid.optional(),
  name: trimmed(2, 60, "Centre name"),
  is_active: z.boolean(),
});
export type CentreInput = z.input<typeof centreSchema>;

const optionalUuid = z.union([z.uuid(), z.literal("")]);

// ---------------------------------------------------------------- tasks
export const taskSchema = z.object({
  id: uuid.optional(),
  title: trimmed(2, 150, "Title"),
  description: optionalText(2000, "Details"),
  assignee_id: z.uuid("Choose a member"),
  role_id: optionalUuid,
  exam_id: optionalUuid,
  centre_id: optionalUuid,
  quantity: z.number().int().min(1, "At least 1").max(100000, "Too large").nullable(),
  due_date: z.union([isoDate, z.literal("")]),
  priority: z.enum(["normal", "high"]),
  /** Task type, and its field values by field id (checked against the type on the server). */
  type_id: optionalUuid.default(""),
  details: z.record(z.string().max(40), z.string().max(2000)).default({}),
});
export type TaskInput = z.input<typeof taskSchema>;

const taskFieldSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]{1,40}$/, "Invalid field"),
    label: trimmed(1, 60, "Field name"),
    kind: z.enum(["text", "long", "link", "date", "number", "select", "file"]),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(80)).max(MAX_TASK_FIELD_OPTIONS).default([]),
  })
  .refine((f) => f.kind !== "select" || f.options.length > 0, { message: "A dropdown needs at least one option" });

export const taskTypeSchema = z.object({
  id: uuid.optional(),
  name: trimmed(2, 60, "Name"),
  icon: z.union([z.enum(TASK_ICON_NAMES), z.literal("")]).default(""),
  color: z.enum(TASK_COLORS).default("blue"),
  description: optionalText(300, "Description"),
  role_id: optionalUuid,
  default_assignee_id: optionalUuid,
  title_template: z.string().trim().max(150).default(""),
  due_days: z.number().int().min(0).max(90).nullable(),
  priority: z.enum(["normal", "high"]),
  active: z.boolean().default(true),
  fields: z
    .array(taskFieldSchema)
    .max(MAX_TASK_FIELDS, `Up to ${MAX_TASK_FIELDS} fields`)
    .refine((fs) => new Set(fs.map((f) => f.id)).size === fs.length, { message: "Two fields have the same id" })
    .refine((fs) => new Set(fs.map((f) => f.label.toLowerCase())).size === fs.length, {
      message: "Two fields have the same name",
    }),
});
export type TaskTypeInput = z.input<typeof taskTypeSchema>;

/** Files uploaded for a task's "File upload" fields: which file goes in which field. */
export const taskFieldFilesSchema = z.object({
  task_id: uuid,
  files: z
    .array(z.object({ field_id: z.string().regex(/^[a-z0-9_]{1,40}$/), file_id: uuid }))
    .min(1)
    .max(20),
});
export type TaskFieldFilesInput = z.input<typeof taskFieldFilesSchema>;

export const taskSendBackSchema = z.object({
  id: uuid,
  note: z.string().trim().min(1, "Say what needs fixing.").max(1000, "Keep it under 1000 characters."),
});

export const taskStatusSchema = z.object({
  id: uuid,
  status: z.enum(["open", "done", "cancelled"]),
});

// ---------------------------------------------------------------- papers
export const PAPER_STAGES = [
  "create_si",
  "typeset_si",
  "convert",
  "typeset_en",
  "review_si",
  "review_en",
  "handover",
  "scheme",
  "scheme_rewrite",
  "scheme_en",
  "mark",
] as const;

const optionalDate = z.union([isoDate, z.literal("")]);
const optionalLink = z.union([
  z.literal(""),
  z.url({ protocol: /^https?$/, error: "Paste a full link starting with https://" }).max(500, "That link is too long"),
]);

export const paperSchema = z
  .object({
    title: trimmed(2, 140, "Title"),
    kind: z.enum(["paper", "tute"]),
    medium: z.enum(["si", "both"]),
    /** "split" = a full paper over two weeks: MCQ this week, SE & Essay the next. */
    part: z.enum(["mcq", "essay", "full", "split"]),
    exam_id: optionalUuid,
    /** Exam for the SE & Essay part when split. */
    exam2_id: optionalUuid,
    exam_day: optionalDate,
    notes: optionalText(1000, "Notes"),
    stages: z
      .array(
        z.object({
          stage: z.enum(PAPER_STAGES),
          owner_id: optionalUuid,
          start_date: optionalDate,
          due_date: optionalDate,
          /** Pre-exam stage times from the work window ("…+05:30"), or "". */
          start_at: z.string().max(40).optional().default(""),
          due_at: z.string().max(40).optional().default(""),
          skip: z.boolean(),
        }),
      )
      .length(PAPER_STAGES.length),
  })
  .refine((v) => v.stages.every((s) => s.skip || !s.start_date || !s.due_date || s.start_date <= s.due_date), {
    message: "A stage starts after its due date. Check the dates.",
    path: ["stages"],
  });
export type PaperInput = z.input<typeof paperSchema>;

export const paperStageUpdateSchema = z
  .object({
    stage_id: uuid,
    owner_id: optionalUuid,
    start_date: optionalDate,
    due_date: optionalDate,
    action: z.enum(["save", "skip", "done"]),
    /** Pre-exam stages: the times picked on the calendar (optional). */
    stage: z.enum(PAPER_STAGES).optional(),
    start_at: z.string().max(40).optional(),
    due_at: z.string().max(40).optional(),
  })
  .refine((v) => !v.start_date || !v.due_date || v.start_date <= v.due_date, {
    message: "The start date is after the due date.",
    path: ["start_date"],
  });

/** Stages that take files (every stage except marking the scripts). */
export const UPLOAD_STAGES = [
  "create_si",
  "typeset_si",
  "convert",
  "typeset_en",
  "review_si",
  "review_en",
  "handover",
  "scheme",
  "scheme_rewrite",
  "scheme_en",
] as const;

export const MAX_PAPER_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

/** A paper made and marked before the system: added as finished, for marking. */
export const pastPaperSchema = z.object({
  title: z.string().trim().min(2, "Give the paper a name").max(130, "Keep the name under 130 letters"),
  parts: z.enum(["split", "mcq", "essay", "full"]),
  medium: z.enum(["si", "both"]),
  exam_day: z.union([z.literal(""), z.iso.date("Choose a valid date")]),
});
export type PastPaperInput = z.input<typeof pastPaperSchema>;

export const paperFileSchema = z.object({
  paper_id: uuid,
  stage: z.enum(UPLOAD_STAGES, "This stage doesn't take files"),
  storage_path: z.string().min(3).max(400),
  file_name: z.string().trim().min(1).max(200),
  mime_type: z.string().max(150).nullable(),
  size_bytes: z.number().int().min(1).max(MAX_PAPER_FILE_BYTES, "Each file must be 25 MB or smaller"),
  tag: z.enum(["paper", "corrected", "images", "answers", "marked", "source", "final", "other"], "Choose what this file is"),
  note: optionalText(300, "Remark"),
});
export type PaperFileInput = z.input<typeof paperFileSchema>;

export const paperFileEditSchema = z.object({
  id: uuid,
  paper_id: uuid,
  file_name: z.string().trim().min(1, "Give the file a name").max(200, "Keep the name under 200 letters"),
  tag: paperFileSchema.shape.tag,
  note: optionalText(300, "Remark"),
});
export type PaperFileEditInput = z.input<typeof paperFileEditSchema>;

export const TASKS_BUCKET = "tasks";
export const MAX_TASK_FILE_BYTES = 50 * 1024 * 1024; // 50 MB, same as the "tasks" bucket
export const MAX_TASK_FILES_AT_ONCE = 20;
export const taskFilesSchema = z.object({
  task_id: uuid,
  kind: z.enum(["brief", "work"]),
  files: z
    .array(
      z.object({
        storage_path: z.string().min(3).max(400),
        file_name: z.string().trim().min(1).max(200),
        mime_type: z.string().max(150).nullable(),
        size_bytes: z.number().int().min(1).max(MAX_TASK_FILE_BYTES, "Each file must be 50 MB or smaller"),
      }),
    )
    .min(1, "Choose a file")
    .max(MAX_TASK_FILES_AT_ONCE, `Up to ${MAX_TASK_FILES_AT_ONCE} files at a time`),
});
export type TaskFilesInput = z.input<typeof taskFilesSchema>;

export const paperDefaultOwnersSchema = z.object({
  owners: z.record(z.enum(PAPER_STAGES), optionalUuid),
});

export const stageLinkSchema = z.object({ stage_id: uuid, link: optionalLink });



// ---------------------------------------------------------------- phone notifications
export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  p256dh: z.string().min(20).max(200),
  auth: z.string().min(8).max(100),
  device: z.string().trim().max(120),
});

// ---------------------------------------------------------------- paper notes, group links, marking log
export const paperNoteSchema = z.object({
  paper_id: uuid,
  stage: z.union([z.enum(PAPER_STAGES), z.literal("")]),
  body: trimmed(1, 3000, "Note"),
});

export const groupLinksSchema = z.object({
  lms_group_link: z.union([z.literal(""), z.url({ protocol: /^https$/, error: "Paste a full link starting with https://" }).max(500)]),
  physical_group_link: z.union([
    z.literal(""),
    z.url({ protocol: /^https$/, error: "Paste a full link starting with https://" }).max(500),
  ]),
});

export const markingLogSchema = z.object({
  paper_ids: z.array(uuid).min(1, "Choose the paper you marked.").max(4),
  rows: z
    .array(
      z.object({
        centre_id: uuid,
        mcq: z.number().int().min(0).max(5000),
        essay: z.number().int().min(0).max(5000),
        full: z.number().int().min(0).max(5000).default(0),
      }),
    )
    .min(1)
    .max(50),
});

// ---------------------------------------------------------------- concession students (admins)
export const CONCESSION_BUCKET = "concession";
export const MAX_CONCESSION_FILE_BYTES = 10 * 1024 * 1024; // 10 MB, same as the "concession" bucket
export const MAX_CONCESSION_FILES_AT_ONCE = 5;
export const CONCESSION_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

/** "077 123 4567", "+94771234567" → "0771234567". */
export function slPhone(value: string): string {
  const digits = value.replace(/[\s-]/g, "");
  return digits.replace(/^\+?94(?=\d{9}$)/, "0");
}

export const concessionStudentSchema = z.object({
  id: uuid.optional(),
  expected_updated_at: z.string().max(40).optional(),
  student_no: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z][0-9A-Z/-]{0,29}$/, "Student ID: letters, numbers, - or /, up to 30"),
  full_name: trimmed(2, 120, "Name"),
  batch_id: z.uuid("Choose a batch"),
  centre_id: optionalUuid,
  card_type: z.enum(["free", "half", "paid"], "Choose the card type"),
  gn_division: optionalText(100, "GN division"),
  certificate_issued_on: optionalDate,
  reason: optionalText(1000, "Reason"),
  monthly_amount: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{1,7}(\.\d{1,2})?$/.test(v) && Number(v) <= 1_000_000), "Enter an amount in rupees"),
  consent_on: optionalDate,
});
export type ConcessionStudentInput = z.input<typeof concessionStudentSchema>;

export const concessionCardSchema = z.object({
  id: uuid,
  expected_updated_at: z.string().max(40).optional(),
  card_type: z.enum(["free", "half", "paid"]),
  status: z.enum(["applied", "verified", "under_review", "ended"]),
  note: optionalText(500, "Reason"),
});
export type ConcessionCardInput = z.input<typeof concessionCardSchema>;

export const concessionGuardianSchema = z.object({
  id: uuid.optional(),
  student_id: uuid,
  relationship: z.enum(["mother", "father", "guardian"], "Choose who this is"),
  full_name: trimmed(2, 120, "Name"),
  occupation: trimmed(2, 100, "Occupation"),
  phone: z
    .string()
    .transform(slPhone)
    .refine((v) => v === "" || /^0\d{9}$/.test(v), "Enter a 10-digit phone number, e.g. 0771234567"),
});
export type ConcessionGuardianInput = z.input<typeof concessionGuardianSchema>;

export const concessionFilesSchema = z.object({
  student_id: uuid,
  files: z
    .array(
      z.object({
        storage_path: z.string().min(3).max(400),
        file_name: z.string().trim().min(1).max(200),
        mime_type: z.string().max(150).nullable(),
        size_bytes: z.number().int().min(1).max(MAX_CONCESSION_FILE_BYTES, "Each file must be 10 MB or smaller"),
      }),
    )
    .min(1, "Choose a file")
    .max(MAX_CONCESSION_FILES_AT_ONCE, `Up to ${MAX_CONCESSION_FILES_AT_ONCE} files at a time`),
});
export type ConcessionFilesInput = z.input<typeof concessionFilesSchema>;

// ---------------------------------------------------------------- student results (results page)
export const examPartSchema = z.object({
  id: uuid.optional(),
  exam_id: uuid,
  name: trimmed(1, 60, "Part name"),
  max_marks: z.coerce.number<string | number>("Enter the full marks").positive("Full marks must be more than 0").max(1000),
  sort_order: z.number().int().min(0).max(100).optional(),
});
export type ExamPartInput = z.input<typeof examPartSchema>;

const markValue = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{1,4}(\.\d{1,2})?$/.test(v), "Marks must be a number");

export const resultsSaveSchema = z.object({
  exam_id: uuid,
  rows: z
    .array(
      z.object({
        student_id: uuid,
        attendance: z.enum(["present", "absent", "excused"]).nullable(),
        note: optionalText(300, "Note"),
        marks: z.record(uuid, markValue),
      }),
    )
    .min(1, "Nothing to save")
    .max(1000),
});
export type ResultsSaveInput = z.input<typeof resultsSaveSchema>;

// ---------------------------------------------------------------- concession payments and flags (admins)
export const concessionPaymentSchema = z
  .object({
    student_id: uuid,
    month: monthKey,
    status: z.enum(["paid", "unpaid"]).nullable(),
    amount: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d{1,7}(\.\d{1,2})?$/.test(v) && Number(v) <= 1_000_000), "Enter an amount in rupees"),
    paid_on: z.union([isoDate, z.literal("")]),
    note: optionalText(300, "Note"),
  })
  .refine((v) => v.status !== "paid" || v.amount !== "", { message: "Enter the amount paid", path: ["amount"] });
export type ConcessionPaymentInput = z.input<typeof concessionPaymentSchema>;

export const concessionFlagSchema = z.object({
  student_id: uuid,
  kind: z.enum(["needs_review", "warning", "top"], "Choose the kind of flag"),
  reason: trimmed(3, 500, "Reason"),
});
export type ConcessionFlagInput = z.input<typeof concessionFlagSchema>;

export const concessionFlagResolveSchema = z.object({ id: uuid, student_id: uuid, note: optionalText(300, "Note") });
export type ConcessionFlagResolveInput = z.input<typeof concessionFlagResolveSchema>;

// ---------------------------------------------------------------- concession CSV import (admins)
const importFileName = z.string().trim().max(200);

export const studentsImportSchema = z.object({
  file_name: importFileName,
  rows: z
    .array(
      concessionStudentSchema.omit({ id: true, expected_updated_at: true }).extend({
        guardians: z.array(concessionGuardianSchema.omit({ id: true, student_id: true })).max(2),
      }),
    )
    .min(1, "Nothing to import")
    .max(1000, "Import at most 1,000 students at a time"),
});
export type StudentsImportInput = z.input<typeof studentsImportSchema>;

export const paymentsImportSchema = z.object({
  file_name: importFileName,
  rows: z
    .array(
      z
        .object({
          student_id: uuid,
          month: monthKey,
          status: z.enum(["paid", "unpaid"]),
          amount: z.string().trim().refine((v) => v === "" || /^\d{1,7}(\.\d{1,2})?$/.test(v), "Enter an amount in rupees"),
          paid_on: z.union([isoDate, z.literal("")]),
          note: optionalText(300, "Note"),
        })
        .refine((v) => v.status !== "paid" || v.amount !== "", "Enter the amount paid"),
    )
    .min(1, "Nothing to import")
    .max(1000, "Import at most 1,000 payments at a time"),
});
export type PaymentsImportInput = z.input<typeof paymentsImportSchema>;

// ---------------------------------------------------------------- fee reminders (monthly paid lists + WhatsApp)
export const CLASS_MODES = ["physical", "online", "both"] as const;
export type ClassMode = (typeof CLASS_MODES)[number];

export const feeClassSchema = z.object({
  id: uuid.optional(),
  batch_id: z.uuid("Choose a batch"),
  name: trimmed(2, 120, "Class name"),
  is_active: z.boolean().default(true),
  mode: z.enum(CLASS_MODES, "Choose Physical, Online or Both").default("both"),
});
export type FeeClassInput = z.input<typeof feeClassSchema>;

const feeImportStudentRowSchema = z.object({
  student_key: trimmed(2, 200, "Student key"),
  full_name: trimmed(1, 150, "Student name"),
  email_norm: optionalText(200, "Email"),
  raw_email: optionalText(200, "Email"),
  whatsapp_norm: z
    .string()
    .regex(/^[0-9]{9,15}$/)
    .nullable(),
  raw_whatsapp: optionalText(60, "WhatsApp"),
  mobile_norm: z
    .string()
    .regex(/^[0-9]{9,15}$/)
    .nullable(),
  raw_mobile: optionalText(60, "Mobile"),
  institute: optionalText(100, "Institute"),
  district: optionalText(100, "District"),
  is_new_student: z.boolean(),
  amount: z.number().min(0).max(10_000_000).nullable(),
  export_label: optionalText(120, "Label"),
  raw_classes: optionalText(500, "Classes"),
});

export const feeMonthImportSchema = z.object({
  batch_id: z.uuid("Choose a batch"),
  month: monthKey,
  file_name: importFileName,
  groups: z
    .array(
      z
        .object({
          /** Existing class ID, or empty string when creating a new class by name. */
          class_id: optionalUuid.default(""),
          /** New class name when class_id is "". */
          new_class_name: optionalText(120, "Class name").default(""),
          raw_row_count: z.number().int().min(0).max(10_000),
          duplicates_merged: z.number().int().min(0).max(10_000),
          rows: z.array(feeImportStudentRowSchema).min(1, "Each selected class must have at least 1 student").max(5000),
        })
        .refine((g) => g.class_id !== "" || g.new_class_name.trim().length >= 2, {
          message: "Choose an existing class or enter a new class name (at least 2 characters).",
        }),
    )
    .min(1, "Select at least one class to import")
    .max(30, "Import at most 30 classes from one file"),
});
export type FeeMonthImportInput = z.input<typeof feeMonthImportSchema>;

export const feeMonthDeleteSchema = z.object({
  class_id: uuid,
  month: monthKey,
});

export const feeFollowupSchema = z.object({
  class_id: uuid,
  due_month: monthKey,
  student_key: trimmed(2, 200, "Student key"),
  student_name: optionalText(150, "Student name"),
  email_norm: optionalText(200, "Email"),
  whatsapp_norm: z
    .string()
    .regex(/^[0-9]{9,15}$/)
    .nullable(),
  // The dialog only picks the first four; the Renewals outcomes are kept when a row is saved again.
  status: z.enum(["pending", "messaged", "excused", "dropped", "promised", "cant_afford", "moved_class"]),
  label: optionalText(80, "Label").nullable().optional(),
  note: optionalText(500, "Note").nullable().optional(),
  template_id: optionalUuid.nullable().optional(),
  increment_message: z.boolean().optional(),
});
export type FeeFollowupInput = z.input<typeof feeFollowupSchema>;

/** An outcome for an unpaid student on the Renewals page. */
export const followupOutcomeSchema = z.object({
  class_id: uuid,
  due_month: monthKey,
  student_key: z.string().min(2).max(200),
  student_name: z.string().max(150),
  whatsapp_norm: z.string().regex(/^[0-9]{9,15}$/).nullable(),
  outcome: z.enum(["no_answer", "promised", "cant_afford", "moved_class", "dropped", "excused"]),
  promised_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date").nullable().optional(),
  reason: z.enum(["exams", "money", "moved_away", "timing", "other_institute", "other"]).nullable().optional(),
  moved_to: uuid.nullable().optional(),
  note: z.string().max(500).optional(),
  called: z.boolean().default(true),
});
export type FollowupOutcomeInput = z.input<typeof followupOutcomeSchema>;

export const callOwnerSchema = z.object({ class_id: uuid, owner_id: uuid.nullable() });
export type CallOwnerInput = z.input<typeof callOwnerSchema>;

export const renewalSettingsSchema = z.object({
  due_day: z.coerce.number().int().min(1, "Pick a day from 1 to 28").max(28, "Pick a day from 1 to 28"),
  target_pct: z.coerce.number().int().min(1, "Pick a share from 1 to 100%").max(100, "Pick a share from 1 to 100%"),
});
export type RenewalSettingsInput = z.input<typeof renewalSettingsSchema>;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
/** Days away (My week). user_id is for admins adding someone else's days off. */
export const dayOffSchema = z
  .object({
    from: isoDay,
    to: isoDay,
    note: z.string().trim().max(200, "Keep the note under 200 characters").default(""),
    user_id: uuid.nullable().optional(),
  })
  .refine((d) => d.to >= d.from, { message: "The last day can't be before the first", path: ["to"] });
export type DayOffInput = z.input<typeof dayOffSchema>;

export const feeTemplateSchema = z.object({
  id: uuid.optional(),
  name: trimmed(2, 80, "Template name"),
  body: trimmed(5, 3000, "Message body"),
  is_default: z.boolean().default(false),
});
export type FeeTemplateInput = z.input<typeof feeTemplateSchema>;

// ---------------------------------------------------------------- monthly & future-month class tutes

// ---------------------------------------------------------------------------
// Tute stock (Phase 1)
// ---------------------------------------------------------------------------
const copies = (label: string, min = 1) =>
  z.coerce
    .number(`${label} must be a number`)
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(100000, `${label} is too large`);

export const tuteCountSchema = z.object({
  tute_id: uuid,
  counted: copies("Count", 0),
  note: optionalText(300, "Note").default(""),
});
export type TuteCountInput = z.input<typeof tuteCountSchema>;

export const tuteIssueSchema = z
  .object({
    tute_id: uuid,
    qty: copies("Copies"),
    kind: z.enum(["class_issue", "damaged"]),
    class_id: uuid.nullable().default(null),
    month: monthKey,
    note: optionalText(300, "Note").default(""),
  })
  .refine((v) => v.kind !== "class_issue" || v.class_id, { message: "Pick the class", path: ["class_id"] });
export type TuteIssueInput = z.input<typeof tuteIssueSchema>;

/** Count all: one shelf count per tute (blank rows are left out by the page). */
export const tuteCountManySchema = z
  .array(z.object({ tute_id: uuid, counted: copies("Count", 0) }))
  .min(1, "Enter at least one count")
  .max(300);
export type TuteCountManyInput = z.input<typeof tuteCountManySchema>;

/** Hand out by class: copies of several tutes given to one class in a month. */
export const tuteHandOutSchema = z.object({
  class_id: uuid,
  month: monthKey,
  items: z
    .array(z.object({ tute_id: uuid, qty: copies("Copies") }))
    .min(1, "Enter copies for at least one tute")
    .max(100),
});
export type TuteHandOutInput = z.input<typeof tuteHandOutSchema>;

export const tuteSaveSchema = z.object({
  id: uuid.optional(),
  name: trimmed(2, 150, "Tute name"),
  code: optionalText(30, "Tute code").default(""),
  is_active: z.boolean().default(true),
  pages: z.coerce.number().int().min(1, "Pages must be at least 1").max(2000).nullable(),
  reorder_level: z.coerce.number().int().min(0).max(100000).nullable(),
  print_batch: z.coerce.number().int().min(1, "Print in batches of at least 1").max(10000),
  paper_id: uuid.nullable().default(null),
  opening_stock: z.coerce.number().int().min(0, "Opening copies can't be negative").max(100000).nullable().optional(),
  schedule_class_ids: z.array(uuid).max(50).optional(),
  schedule_month: monthKey.optional(),
});
export type TuteSaveInput = z.input<typeof tuteSaveSchema>;

export const tutePrinterSchema = z.object({
  id: uuid.optional(),
  name: trimmed(2, 100, "Printer name"),
  phone: phone("phone number").default(""),
  notes: optionalText(300, "Notes").default(""),
  usual_days: z.coerce.number().int().min(1, "At least 1 day").max(90, "At most 90 days"),
  is_active: z.boolean().default(true),
});
export type TutePrinterInput = z.input<typeof tutePrinterSchema>;

export const tutePrintJobSchema = z.object({
  tute_id: uuid,
  qty: copies("Copies"),
  printer_id: uuid.nullable().default(null),
  due_date: isoDate.nullable().default(null),
  cost: z.coerce.number().min(0, "Cost can't be negative").max(100000000).nullable().default(null),
  note: optionalText(300, "Note").default(""),
});
export type TutePrintJobInput = z.input<typeof tutePrintJobSchema>;

export const tutePrintJobUpdateSchema = z.object({
  id: uuid,
  qty: copies("Copies"),
  printer_id: uuid.nullable().default(null),
  due_date: isoDate.nullable().default(null),
  cost: z.coerce.number().min(0, "Cost can't be negative").max(100000000).nullable().default(null),
  note: optionalText(300, "Note").default(""),
});
export type TutePrintJobUpdateInput = z.input<typeof tutePrintJobUpdateSchema>;

export const tuteReceiveSchema = z.object({
  id: uuid,
  qty: copies("Copies"),
  cost: z.coerce.number().min(0, "Cost can't be negative").max(100000000).nullable().optional(),
});
export type TuteReceiveInput = z.input<typeof tuteReceiveSchema>;

export const tuteJobStatusSchema = z.object({ id: uuid, status: z.enum(["printing", "cancelled"]) });
export type TuteJobStatusInput = z.input<typeof tuteJobStatusSchema>;

export const MAX_TUTE_COVER_BYTES = 5 * 1024 * 1024;
export const tuteCoverSchema = z.object({
  tute_id: uuid,
  path: z.string().trim().min(1).max(300).nullable(),
});
export type TuteCoverInput = z.input<typeof tuteCoverSchema>;

// ---------------------------------------------------------------------------
// Speed Post (Phase 3)
// ---------------------------------------------------------------------------
export const postAddressSchema = z.object({
  student_key: z.string().trim().min(2).max(200),
  address: trimmed(1, 500, "Address"),
  checked: z.boolean().default(true),
});
export type PostAddressInput = z.input<typeof postAddressSchema>;

/** One student on an uploaded Speed Post list (the address is saved privately). */
const postListRowSchema = z.object({
  student_key: trimmed(2, 200, "Student key"),
  full_name: trimmed(1, 150, "Student name"),
  whatsapp: z
    .string()
    .regex(/^[0-9]{9,15}$/)
    .nullable(),
  address: optionalText(500, "Address").default(""),
  district: optionalText(100, "District").default(""),
});

export const postListUploadSchema = z.object({
  class_id: z.uuid("Choose a class"),
  month: monthKey,
  file_name: importFileName,
  rows: z.array(postListRowSchema).min(1, "The list has no students").max(5000, "At most 5,000 students"),
});
export type PostListUploadInput = z.input<typeof postListUploadSchema>;

export const postListDeleteSchema = z.object({ class_id: uuid, month: monthKey });
export type PostListDeleteInput = z.input<typeof postListDeleteSchema>;

export const postRoundBuildSchema = z.object({ batch_id: uuid, month: monthKey, kind: z.enum(["main", "top_up"]) });
export type PostRoundBuildInput = z.input<typeof postRoundBuildSchema>;

export const postTrackingSchema = z.object({ id: uuid, tracking: optionalText(60, "Tracking number") });
export type PostTrackingInput = z.input<typeof postTrackingSchema>;

export const postHandoverSchema = z.object({
  id: uuid,
  receipt_total: z.coerce.number().min(0, "Can't be negative").max(100000000).nullable().default(null),
});
export type PostHandoverInput = z.input<typeof postHandoverSchema>;

export const postParcelStatusSchema = z.object({
  id: uuid,
  status: z.enum(["delivered", "returned", "lost"]),
  copies_ok: z.boolean().default(true),
});
export type PostParcelStatusInput = z.input<typeof postParcelStatusSchema>;

// ---------------------------------------------------------------------------
// Classes page
// ---------------------------------------------------------------------------
/** Today's "paid so far" for a class (this month). */
export const classPaidCountSchema = z.object({ class_id: uuid, count: copies("Paid students", 0) });
export type ClassPaidCountInput = z.input<typeof classPaidCountSchema>;

/** A class's monthly fee from a month onwards (Money page, main admins). */
export const classFeeSchema = z.object({
  class_id: uuid,
  from_month: monthKey,
  // "2,500" is fine; a blank box must never become Rs 0.
  fee: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/[,\s]/g, "") || undefined : v),
    z.coerce.number({ message: "Enter the fee" }).min(0, "The fee can't be below 0").max(10_000_000, "The fee is too large"),
  ),
});
export type ClassFeeInput = z.input<typeof classFeeSchema>;

/** Schedule several tutes for several classes in one month. */
export const classTutesAssignSchema = z.object({
  month: monthKey,
  class_ids: z.array(uuid).min(1, "Pick at least one class").max(100),
  tute_ids: z.array(uuid).min(1, "Pick at least one tute").max(100),
});
export type ClassTutesAssignInput = z.input<typeof classTutesAssignSchema>;

export const classTutesCopySchema = z
  .object({
    class_id: uuid,
    from_month: monthKey,
    to_month: monthKey,
  })
  .refine((v) => v.from_month !== v.to_month, { message: "Choose two different months" });
export type ClassTutesCopyInput = z.input<typeof classTutesCopySchema>;
