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
});
export type SubmissionInput = z.input<typeof submissionSchema>;

export const submissionActionSchema = submissionSchema.extend({
  attachments: z.array(attachmentInputSchema).max(MAX_ATTACHMENTS, `Up to ${MAX_ATTACHMENTS} files`),
  removed_attachment_ids: z.array(uuid).max(50).default([]),
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

export const memberUpdateSchema = memberBase.extend({ id: uuid });
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
