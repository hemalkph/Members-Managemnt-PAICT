import { z } from "zod";
import { parseNic } from "@/lib/nic";

// Shared by client forms (react-hook-form) and Server Actions.
// The server ALWAYS re-validates with these schemas.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_ATTACHMENTS = 10;
export const MAX_LINKS = 10;

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

export const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

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
});

/** Paper work draft: only the page count is entered. */
export const paperPagesSchema = z.object({
  task_id: uuid,
  pages: z.number({ error: "Enter the number of pages" }).int("Use a whole number").min(1, "At least 1 page").max(2000, "That's too many pages"),
});

// ---------------------------------------------------------------- review
export const reviewSchema = z
  .object({
    ids: z.array(uuid).min(1, "Select at least one submission").max(200),
    decision: z.enum(["approved", "rejected", "pending"]),
    comment: optionalText(1000, "Comment"),
  })
  .refine((v) => v.decision !== "rejected" || v.comment.length > 0, {
    message: "Please add a comment explaining why it was rejected",
    path: ["comment"],
  });
export type ReviewInput = z.input<typeof reviewSchema>;

// ---------------------------------------------------------------- members (admin)
const memberBase = z.object({
  full_name: trimmed(2, 120, "Full name"),
  phone: phone("phone number"),
  whatsapp: phone("WhatsApp number"),
  nic,
  role_ids: z.array(uuid).max(50),
  is_admin: z.boolean(),
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

// ---------------------------------------------------------------- deadlines (main admins)
export const deadlineSettingsSchema = z.object({
  enabled: z.boolean(),
  day: z.number({ error: "Choose a day" }).int().min(1, "Choose a day from 1 to 28").max(28, "Choose a day from 1 to 28"),
  reminderDays: z.number({ error: "Choose a number" }).int().min(0, "0 to 10 days").max(10, "0 to 10 days"),
});
export type DeadlineSettingsInput = z.input<typeof deadlineSettingsSchema>;

export const monthDeadlineSchema = z.object({
  month: monthKey,
  /** Last day work is accepted, or "" for the normal rule. */
  lastDay: z.union([isoDate, z.literal("")]),
});
export type MonthDeadlineInput = z.input<typeof monthDeadlineSchema>;

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
});
export type TaskInput = z.input<typeof taskSchema>;

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

export const paperFileSchema = z.object({
  paper_id: uuid,
  stage: z.enum(UPLOAD_STAGES, "This stage doesn't take files"),
  storage_path: z.string().min(3).max(400),
  file_name: z.string().trim().min(1).max(200),
  mime_type: z.string().max(150).nullable(),
  size_bytes: z.number().int().min(1).max(MAX_PAPER_FILE_BYTES, "Each file must be 25 MB or smaller"),
  note: optionalText(300, "Note"),
});
export type PaperFileInput = z.input<typeof paperFileSchema>;

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

// ---------------------------------------------------------------- tute dispatch
const dispatchPhone = z
  .string()
  .trim()
  .refine((v) => v === "" || /^0\d{9}$/.test(v), "Use 10 digits starting with 0, e.g. 0771234567");

export const studentSchema = z.object({
  id: z.union([uuid, z.literal("")]),
  batch_id: uuid,
  student_no: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z][0-9A-Z-]{0,19}$/, "Use letters, numbers or - (max 20), e.g. 088"),
  full_name: trimmed(1, 120, "Name"),
  address_line1: optionalText(200, "Address line 1"),
  address_line2: optionalText(200, "Address line 2"),
  address_line3: optionalText(200, "Address line 3"),
  city: optionalText(60, "City"),
  region: optionalText(60, "Region"),
  phone1: z.string().trim().max(40),
  phone2: z.string().trim().max(40),
  delivery_note: optionalText(300, "Delivery note"),
  expected_updated_at: z.string().max(40),
});
export type StudentInput = z.input<typeof studentSchema>;

export const dispatchSettingsSchema = z.object({
  sender_name: optionalText(100, "Sender name"),
  sender_line1: optionalText(200, "Address line 1"),
  sender_line2: optionalText(200, "Address line 2"),
  sender_line3: optionalText(200, "Address line 3"),
  sender_city: optionalText(60, "City"),
  sender_contact_name: optionalText(100, "Contact name"),
  sender_phone1: dispatchPhone,
  sender_phone2: dispatchPhone,
  default_cod: z.coerce.number().min(0, "COD can't be negative").max(1_000_000),
  default_weight_g: z.coerce.number().int().min(1).max(30_000),
  default_pieces: z.coerce.number().int().min(1).max(20),
  require_verification: z.boolean(),
  allow_self_verify: z.boolean(),
  student_retention_months: z.coerce.number().int().min(1).max(120),
  recipient_retention_days: z.coerce.number().int().min(30).max(3650),
  courier_file_retention_days: z.coerce.number().int().min(7).max(3650),
  import_file_retention_days: z.coerce.number().int().min(1).max(365),
});
export type DispatchSettingsInput = z.input<typeof dispatchSettingsSchema>;

export const dispatchGrantSchema = z.object({
  user_id: uuid,
  capability: z.enum(["plan", "courier", "pack", "verify", "correct", "finance"]),
  grant: z.boolean(),
  reason: optionalText(300, "Reason"),
});

const columnSource = z.object({ column: z.number().int().min(0).max(59), fromReference: z.boolean().optional() });
export const importMappingSchema = z.object({
  student_no: columnSource.optional(),
  full_name: columnSource.optional(),
  address_line1: columnSource.optional(),
  address_line2: columnSource.optional(),
  address_line3: columnSource.optional(),
  city: columnSource.optional(),
  region: columnSource.optional(),
  phone1: columnSource.optional(),
  phone2: columnSource.optional(),
  delivery_note: columnSource.optional(),
});

export const importStepSchema = z.object({
  import_id: uuid,
  mapping: importMappingSchema,
});

export const importApplySchema = importStepSchema.extend({
  lines: z.array(z.number().int().min(2).max(2100)).max(2000),
});

export const roundSchema = z.object({
  id: z.union([uuid, z.literal("")]),
  name: trimmed(2, 120, "Round name"),
  batch_id: uuid,
  sending_month: monthKey,
  group_label: optionalText(60, "Group"),
  subject: optionalText(60, "Subject"),
  ref_prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,20}$/, "Use 2–20 capital letters or numbers, e.g. 27TGNOVICT"),
  default_cod: z.coerce.number().min(0, "COD can't be negative").max(1_000_000),
  default_weight_g: z.coerce.number().int().min(1).max(30_000),
  default_pieces: z.coerce.number().int().min(1).max(20),
  planned_handover: z.union([isoDate, z.literal("")]),
  notes: optionalText(500, "Notes"),
});
export type RoundInput = z.input<typeof roundSchema>;

export const roundTutesSchema = z.object({
  round_id: uuid,
  tutes: z
    .array(
      z.object({
        id: z.union([uuid, z.literal("")]),
        paper_id: z.union([uuid, z.literal("")]),
        manual_title: optionalText(150, "Title"),
        short_code: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9-]{1,10}$/, "Short code: up to 10 capital letters, numbers or -"),
        version_label: optionalText(30, "Version"),
        qty_per_parcel: z.coerce.number().int().min(1).max(10),
        is_extra: z.boolean(),
      }),
    )
    .max(30),
});
export type RoundTutesInput = z.input<typeof roundTutesSchema>;

export const roundStudentsSchema = z.object({
  round_id: uuid,
  rows: z
    .array(
      z.object({
        student_id: uuid,
        cod_amount: z.union([z.literal(""), z.coerce.number().min(0).max(1_000_000)]),
        note: optionalText(300, "Note"),
        excluded_tute_ids: z.array(uuid).max(30),
        extra_tute_ids: z.array(uuid).max(30),
      }),
    )
    .max(3000),
});
export type RoundStudentsInput = z.input<typeof roundStudentsSchema>;

export const savedTuteSchema = z.object({
  id: z.union([uuid, z.literal("")]),
  title: trimmed(1, 150, "Title"),
  short_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,10}$/, "Short code: up to 10 capital letters, numbers or -"),
  version_label: optionalText(30, "Version"),
  qty_per_parcel: z.coerce.number().int().min(1).max(10),
});
export type SavedTuteInput = z.input<typeof savedTuteSchema>;

export const parcelCorrectionSchema = z.object({
  parcel_id: uuid,
  row_version: z.number().int().min(1),
  reason: trimmed(3, 300, "Reason"),
  cod_expected: z.union([z.literal(""), z.coerce.number().min(0).max(1_000_000)]),
  tute_ids: z.array(uuid).min(1, "Keep at least one tute").max(30),
  recipient: z.object({
    name: trimmed(1, 120, "Name"),
    address_line1: trimmed(1, 200, "Address line 1"),
    address_line2: optionalText(200, "Address line 2"),
    address_line3: optionalText(200, "Address line 3"),
    city: trimmed(1, 60, "City"),
    phone1: z.string().trim().min(1, "Phone is needed").max(40),
    phone2: z.string().trim().max(40),
  }),
});
export type ParcelCorrectionInput = z.input<typeof parcelCorrectionSchema>;

export const roundFileSchema = z.object({
  round_id: uuid,
  path: z.string().max(120),
  file_name: z.string().max(200),
});
