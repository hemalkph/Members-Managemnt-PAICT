// Customizable WhatsApp message template helpers (placeholders, emojis & api.whatsapp.com links).
// Uses api.whatsapp.com/send (same as lib/tasks/whatsapp.ts) because wa.me corrupts emojis.

import { whatsAppLink } from "@/lib/tasks/whatsapp";

export type TemplateVariable = {
  token: string;
  label: string;
  example: string;
};

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { token: "{first_name}", label: "First name", example: "Ayodya" },
  { token: "{name}", label: "Full name", example: "Ayodya Karunasena" },
  { token: "{class}", label: "Class name", example: "2027 Grand Revision" },
  { token: "{month}", label: "Current month (English)", example: "November 2026" },
  { token: "{prev_month}", label: "Previous month (English)", example: "October 2026" },
  { token: "{month_si}", label: "Current month (Sinhala)", example: "නොවැම්බර්" },
  { token: "{prev_month_si}", label: "Previous month (Sinhala)", example: "ඔක්තෝබර්" },
  { token: "{amount}", label: "Fee amount", example: "Rs. 3,000" },
  { token: "{institute}", label: "Institute / Online", example: "Online" },
  { token: "{label}", label: "Student label", example: "Half card" },
  { token: "{tutes}", label: "This month's tutes (comma-separated)", example: "Unit 07 Database, SQL Pack" },
  { token: "{tutes_list}", label: "This month's tutes (emoji list)", example: "📘 Unit 07 Database" },
  { token: "{tute_count}", label: "Tute count", example: "2" },
  { token: "{next_month_tutes}", label: "Next month's tutes", example: "Unit 08 Networking" },
  { token: "{next_month_tutes_list}", label: "Next month's tutes (emoji list)", example: "📘 Unit 08 Networking" },
];

const SINHALA_MONTHS: Record<string, string> = {
  january: "ජනවාරි",
  jan: "ජනවාරි",
  "01": "ජනවාරි",
  february: "පෙබරවාරි",
  feb: "පෙබරවාරි",
  "02": "පෙබරවාරි",
  march: "මාර්තු",
  mar: "මාර්තු",
  "03": "මාර්තු",
  april: "අප්‍රේල්",
  apr: "අප්‍රේල්",
  "04": "අප්‍රේල්",
  may: "මැයි",
  "05": "මැයි",
  june: "ජූනි",
  jun: "ජූනි",
  "06": "ජූනි",
  july: "ජූලි",
  jul: "ජූලි",
  "07": "ජූලි",
  august: "අගෝස්තු",
  aug: "අගෝස්තු",
  "08": "අගෝස්තු",
  september: "සැප්තැම්බර්",
  sep: "සැප්තැම්බර්",
  sept: "සැප්තැම්බර්",
  "09": "සැප්තැම්බර්",
  october: "ඔක්තෝබර්",
  oct: "ඔක්තෝබර්",
  "10": "ඔක්තෝබර්",
  november: "නොවැම්බර්",
  nov: "නොවැම්බර්",
  "11": "නොවැම්බර්",
  december: "දෙසැම්බර්",
  dec: "දෙසැම්බර්",
  "12": "දෙසැම්බර්",
};

/** Convert "November 2026" or "2026-11" to its Sinhala Unicode month name ("නොවැම්බර්"). */
export function sinhalaMonthName(monthLabelOrKey: string): string {
  const trimmed = monthLabelOrKey.trim();
  const keyMatch = trimmed.match(/^\d{4}-(0[1-9]|1[0-2])$/);
  if (keyMatch) return SINHALA_MONTHS[keyMatch[1]] ?? trimmed;
  const wordMatch = trimmed.toLowerCase().match(/\b([a-z]+)\b/);
  if (wordMatch && SINHALA_MONTHS[wordMatch[1]]) return SINHALA_MONTHS[wordMatch[1]];
  return trimmed;
}

export const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Greetings",
    emojis: ["👋", "😊", "🙏", "✨", "🌟", "💐", "🙌", "🤝", "🤗", "☀️"],
  },
  {
    label: "Study & Class",
    emojis: ["📚", "🎓", "📝", "📖", "💻", "🏫", "✏️", "📌", "🎯", "🏆", "💡", "🧠"],
  },
  {
    label: "Reminders & Fees",
    emojis: ["📢", "⏰", "⏳", "🔔", "🗓️", "💳", "💰", "🧾", "⚠️", "❗", "📣", "📲"],
  },
  {
    label: "Status & Replies",
    emojis: ["✅", "☑️", "💬", "📩", "📞", "👉", "⬇️", "❤️", "💚", "🔥", "🎉", "👏"],
  },
];

export const QUICK_LABELS = [
  "Free card",
  "Half card",
  "Paid card",
  "Promised to pay",
  "Paid (receipt pending)",
  "Wrong number",
  "Left class",
] as const;

export type FeeMessageContext = {
  fullName: string;
  className: string;
  monthLabel: string;
  prevMonthLabel: string;
  amount: number | null;
  institute: string;
  label: string;
  /** Tute names scheduled for the current due month (in display order). */
  tutes?: string[];
  /** Tute names pre-scheduled for the next calendar month (in display order). */
  nextMonthTutes?: string[];
};

const TUTE_TOKEN_RE = /\{(tutes|tutes_list|tute_count)\}/;

/** True when a template references current-month tutes placeholders. */
export function templateUsesTutes(templateBody: string): boolean {
  return TUTE_TOKEN_RE.test(templateBody);
}

export function formatFeeRs(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "";
  return `Rs. ${new Intl.NumberFormat("en-LK", { maximumFractionDigits: 0 }).format(amount)}`;
}

/** Fill template placeholders cleanly for one student. */
export function renderFeeMessage(templateBody: string, ctx: FeeMessageContext): string {
  const fullName = ctx.fullName.trim() || "Student";
  const firstName = fullName.split(/\s+/)[0] || fullName;
  const amountText = formatFeeRs(ctx.amount);
  const tutes = (ctx.tutes ?? []).map((t) => t.trim()).filter(Boolean);
  const nextTutes = (ctx.nextMonthTutes ?? []).map((t) => t.trim()).filter(Boolean);

  const values: Record<string, string> = {
    "{name}": fullName,
    "{first_name}": firstName,
    "{class}": ctx.className.trim(),
    "{month}": ctx.monthLabel.trim(),
    "{prev_month}": ctx.prevMonthLabel.trim(),
    "{month_si}": sinhalaMonthName(ctx.monthLabel),
    "{prev_month_si}": sinhalaMonthName(ctx.prevMonthLabel),
    "{amount}": amountText,
    "{institute}": ctx.institute.trim() || "Online",
    "{label}": ctx.label.trim(),
    "{tutes}": tutes.join(", "),
    "{tutes_list}": tutes.map((t) => `📘 ${t}`).join("\n"),
    "{tute_count}": tutes.length > 0 ? String(tutes.length) : "",
    "{next_month_tutes}": nextTutes.join(", "),
    "{next_month_tutes_list}": nextTutes.map((t) => `📘 ${t}`).join("\n"),
  };

  let out = templateBody;
  for (const [token, value] of Object.entries(values)) {
    out = out.split(token).join(value);
  }
  // Tidy up empty parens when optional values like {amount} or {label} are blank,
  // and collapse excess blank lines when {tutes_list} is empty.
  out = out.replace(/\s*\(\s*\)/g, "").replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/** Build an emoji-safe WhatsApp link using api.whatsapp.com/send. */
export function feeWhatsAppUrl(phoneDigits: string, renderedMessage: string): string {
  return whatsAppLink(phoneDigits, renderedMessage);
}
