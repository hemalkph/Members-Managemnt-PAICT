// Parses monthly paid student exports (.xlsx or .csv) — single-class OR multi-class,
// supporting BOTH:
//   1. Standard Paid Students exports (Gmail, WhatsApp, Mobile, Classes, Total Amount, Label, New Students/Summary sheets)
//   2. Enrollments exports (Student name, Class, Status, Method, Access state, Student index, Mobile, Item/Value footer)
// Handles real LMS export quirks:
//   - Auto-excludes non-paid enrollment attempts (Status: rejected/failed/pending/cancelled; Access state: revoked)
//     BEFORE deduplication so failed/rejected payment retries are never counted as paid or as duplicate payments
//   - Multi-sheet .xlsx / multi-section .csv (All Students + "New Students" + "Summary" + "Item,Value" footers)
//   - Multiline quoted addresses & Sinhala UTF-8
//   - Class name normalization ("2027 Grand Revision - October Class (2027 A/L)" -> "2027 Grand Revision")
//   - Hybrid single-class & multi-class splitting without overlapping student data across classes
//   - Same-month deduplication by normalized email, WhatsApp/Mobile phone, or Student index (with name compatibility)
//   - Optional label/concession column detection + FREE_ENROLLMENT auto-labeling

import { parseCsv } from "@/lib/students/csv";
import { normalizeWaPhone } from "@/lib/fees/phone";
import { parseXlsx } from "@/lib/fees/xlsx";

export type ParsedStudentRecord = {
  student_key: string;
  full_name: string;
  email_norm: string;
  raw_email: string;
  whatsapp_norm: string | null;
  raw_whatsapp: string;
  mobile_norm: string | null;
  raw_mobile: string;
  institute: string;
  district: string;
  is_new_student: boolean;
  amount: number | null;
  export_label: string;
  raw_classes: string;
  /** Number of rows merged into this unique student (1 = no duplicate). */
  mergedCount: number;
  /** Any alternate emails/names seen when duplicates were merged. */
  alternateEmails: string[];
};

export type ExcludedRowReason = "rejected" | "failed" | "pending" | "revoked" | "other";

export type ExcludedRowsSummary = {
  total: number;
  rejected: number;
  failed: number;
  pending: number;
  revoked: number;
  other: number;
  /** Distinct student names that had excluded rows (capped at 25 for preview tooltips). */
  sampleNames: string[];
};

export function emptyExcludedSummary(): ExcludedRowsSummary {
  return { total: 0, rejected: 0, failed: 0, pending: 0, revoked: 0, other: 0, sampleNames: [] };
}

export function formatExcludedSummary(summary: ExcludedRowsSummary): string {
  const parts: string[] = [];
  if (summary.rejected > 0) parts.push(`${summary.rejected} rejected`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  if (summary.revoked > 0) parts.push(`${summary.revoked} revoked`);
  if (summary.pending > 0) parts.push(`${summary.pending} pending`);
  if (summary.other > 0) parts.push(`${summary.other} unpaid`);
  return parts.join(", ");
}

function recordExcluded(summary: ExcludedRowsSummary, reason: ExcludedRowReason, fullName: string) {
  summary.total++;
  summary[reason]++;
  if (fullName && summary.sampleNames.length < 25 && !summary.sampleNames.includes(fullName)) {
    summary.sampleNames.push(fullName);
  }
}

export type DetectedClassGroup = {
  /** Normalized class name (e.g. "2027 Grand Revision"), or "" if the export had no Classes column. */
  detectedName: string;
  /** Sample raw class string as written in the file. */
  rawSample: string;
  /** Batch hint extracted from "(2027 A/L)" or leading year if present. */
  batchHint: string | null;
  /** Month number (1..12) extracted from "- October Class" if present. */
  monthNumberHint: number | null;
  /** Number of valid paid rows before same-month deduplication. */
  rawRowCount: number;
  /** Number of genuine duplicate paid rows merged inside this class-month. */
  duplicatesMerged: number;
  /** Names of students whose duplicate paid rows were merged. */
  mergedNames: string[];
  /** Non-paid rows (rejected / failed / pending / revoked) filtered out before deduplication. */
  excludedRows: ExcludedRowsSummary;
  /** Number of students missing a valid WhatsApp number. */
  missingPhoneCount: number;
  /** Deduplicated paid students belonging strictly to this class. */
  students: ParsedStudentRecord[];
};

export type ParsedUploadFile = {
  fileName: string;
  sheetName: string | null;
  /** True when the uploaded file contained a WhatsApp column. */
  hasWhatsAppColumn: boolean;
  /** True when extra "New Students" / "Summary" / "Item,Value" sections or sheets were skipped. */
  skippedExtraSections: boolean;
  /** File-wide summary of non-paid rows filtered out (rejected, failed, pending, revoked). */
  excludedRows: ExcludedRowsSummary;
  /** Month hint (1..12) if consistently detected across the file. */
  monthNumberHint: number | null;
  /** Batch hint (e.g. "2027 A/L" or "2027") if consistently detected across the file. */
  batchHint: string | null;
  /** Distinct classes found in this file (1 for single-class exports, >1 for hybrid multi-class exports). */
  groups: DetectedClassGroup[];
  /** Non-fatal parser warnings to surface in the preview. */
  warnings: string[];
};

const MONTH_NAMES: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const MONTH_REGEX =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;

/**
 * Normalize a raw class title from an LMS export into a stable class name across months:
 *   "2027 Grand Revision - October Class (2027 A/L)"  -> { canonicalName: "2027 Grand Revision", batchHint: "2027 A/L", monthNumber: 10 }
 *   "2027 Grand Revision - November Class (2027 A/L)" -> { canonicalName: "2027 Grand Revision", batchHint: "2027 A/L", monthNumber: 11 }
 */
export function normalizeClassEntry(raw: string): {
  canonicalName: string;
  batchHint: string | null;
  monthNumber: number | null;
} {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return { canonicalName: "", batchHint: null, monthNumber: null };

  let batchHint: string | null = null;
  const batchMatch = text.match(/\(([^)]*20\d{2}[^)]*)\)\s*$/i) ?? text.match(/\b(20\d{2}\s*A\/?L)\b/i);
  if (batchMatch) {
    batchHint = batchMatch[1].replace(/\s+/g, " ").trim();
  }

  let monthNumber: number | null = null;
  const monthMatch = text.match(MONTH_REGEX);
  if (monthMatch) {
    monthNumber = MONTH_NAMES[monthMatch[1].toLowerCase()] ?? null;
  }

  // Strip trailing parenthesized batch tag like "(2027 A/L)".
  text = text.replace(/\s*\([^)]*20\d{2}[^)]*\)\s*$/i, "").trim();

  // Strip trailing " - October Class", " – Nov 2026 Class", " - October", etc.
  text = text
    .replace(
      /\s*[-–—|:]\s*(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+20\d{2})?(?:\s+(?:class|month|fee|fees|batch|session))?\s*$/i,
      "",
    )
    .trim();

  // Also handle trailing month without dash: "2027 Theory October Class" -> "2027 Theory"
  text = text
    .replace(
      /\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+20\d{2})?\s+(?:class|month|fee|fees)\s*$/i,
      "",
    )
    .trim();

  // Clean dangling separators.
  text = text.replace(/\s*[-–—|:]\s*$/, "").trim();

  // If no explicit "(2027 A/L)" tag was present, infer a leading/embedded batch year from the canonical class name
  // (e.g. "2027 Grand Revision - October Class" -> batchHint: "2027").
  if (!batchHint) {
    const yearMatch = text.match(/\b(20\d{2})\b/);
    if (yearMatch) batchHint = yearMatch[1];
  }

  return {
    canonicalName: text || raw.trim(),
    batchHint,
    monthNumber,
  };
}

/**
 * Split a `Classes` cell that may contain multiple classes (when Classes Count > 1).
 * Handles newline, semicolon, pipe, or comma-separated class lists safely.
 */
export function splitClassesCell(raw: string, expectedCount?: number): string[] {
  const cleaned = raw.trim();
  if (!cleaned) return [];

  // Prefer explicit hard delimiters first: newline, pipe, semicolon.
  if (/[\r\n|;]/.test(cleaned)) {
    const parts = cleaned
      .split(/[\r\n|;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 1) return parts;
  }

  // Comma-separated classes: split on commas when Classes Count > 1 OR when commas follow ")" or precede a class pattern.
  if (cleaned.includes(",")) {
    const byComma = cleaned
      .split(/\s*,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      (expectedCount && expectedCount > 1 && byComma.length >= 2) ||
      byComma.every((p) => MONTH_REGEX.test(p) || /\(20\d{2}/i.test(p))
    ) {
      return byComma;
    }
  }

  return [cleaned];
}

// Column header lookup helpers.
type ColumnMap = {
  email: number;
  name: number;
  newStudent: number;
  mobile: number;
  whatsapp: number;
  institute: number;
  district: number;
  classesCount: number;
  classes: number;
  amount: number;
  label: number;
  status: number;
  accessState: number;
  method: number;
  studentIndex: number;
};

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findColumn(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h === alias);
    if (idx >= 0) return idx;
  }
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h.includes(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Strict exact-match column lookup so auxiliary columns never match unrelated fields like "Delivery Status". */
function findExactColumn(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h === alias);
    if (idx >= 0) return idx;
  }
  return -1;
}

function detectColumns(row: string[]): ColumnMap | null {
  const headers = row.map(normHeader);
  const name = findColumn(headers, ["student name", "full name", "name"]);
  const email = findColumn(headers, ["gmail", "email", "e mail", "email address"]);
  const whatsapp = findColumn(headers, ["whatsapp", "whatsapp number", "whatsapp no", "wa"]);
  const mobile = findColumn(headers, ["mobile", "mobile number", "phone", "phone number", "contact"]);

  // A valid student table header must have Name AND at least one of Email/WhatsApp/Mobile.
  if (name < 0 || (email < 0 && whatsapp < 0 && mobile < 0)) return null;

  return {
    name,
    email,
    whatsapp,
    mobile,
    newStudent: findColumn(headers, ["new student", "new", "first paid"]),
    institute: findColumn(headers, ["institute", "centre", "center", "hall"]),
    district: findColumn(headers, ["district"]),
    classesCount: findColumn(headers, ["classes count", "class count"]),
    classes: findColumn(headers, ["classes", "class", "class name", "course"]),
    amount: findColumn(headers, ["total amount rs", "total amount", "amount rs", "amount", "fee", "paid amount"]),
    label: findColumn(headers, [
      "label",
      "labels",
      "card",
      "card type",
      "fee type",
      "concession",
      "payment type",
      "category",
      "tag",
      "student type",
      "discount",
    ]),
    status: findExactColumn(headers, ["status", "payment status", "enrollment status", "enrolment status"]),
    accessState: findExactColumn(headers, ["access state", "access status", "access"]),
    method: findExactColumn(headers, ["method", "payment method", "enrollment method", "enrolment method"]),
    studentIndex: findExactColumn(headers, [
      "student index",
      "index",
      "index no",
      "index number",
      "student id",
      "reg no",
      "registration no",
    ]),
  };
}

function isSummaryRow(row: string[]): boolean {
  const c0 = normHeader(row[0] ?? "");
  const c1 = normHeader(row[1] ?? "");
  const nonEmptyCols = row.filter((cell) => cell.trim() !== "").length;
  return (
    (c0 === "metric" && c1 === "value") ||
    (c0 === "item" && c1 === "value") ||
    (c0 === "field" && c1 === "value") ||
    (c0 === "property" && c1 === "value") ||
    (c0 === "report" && nonEmptyCols <= 2) ||
    c0 === "total students" ||
    c0 === "pickup by institute" ||
    c0 === "summary"
  );
}

const REJECTED_STATUSES = new Set(["rejected", "declined", "denied"]);
const FAILED_STATUSES = new Set(["failed", "error", "payment_failed", "unsuccessful"]);
const PENDING_STATUSES = new Set([
  "pending",
  "pending_review",
  "pending_payment",
  "processing",
  "awaiting",
  "awaiting_approval",
  "draft",
  "incomplete",
  "unpaid",
]);
const REVOKED_STATUSES = new Set(["revoked", "cancelled", "canceled", "refunded", "void"]);
const REVOKED_ACCESS_STATES = new Set(["revoked", "suspended", "blocked", "cancelled", "canceled"]);

/**
 * Determine whether an enrollment row represents a non-paid / revoked attempt that must be excluded
 * BEFORE deduplication.
 * - `Status = activated` + `Access state = active | expired` -> VALID (returns null).
 * - `Status = rejected | failed | pending | cancelled` -> EXCLUDED.
 * - `Access state = revoked | suspended | blocked` -> EXCLUDED.
 * - Exports without `Status` / `Access state` columns -> VALID (returns null).
 */
export function classifyRowExclusion(statusRaw: string, accessStateRaw: string): ExcludedRowReason | null {
  const status = statusRaw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const access = accessStateRaw.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (status) {
    if (REJECTED_STATUSES.has(status)) return "rejected";
    if (FAILED_STATUSES.has(status)) return "failed";
    if (PENDING_STATUSES.has(status)) return "pending";
    if (REVOKED_STATUSES.has(status)) return "revoked";
  }

  if (access) {
    if (REVOKED_ACCESS_STATES.has(access)) return "revoked";
    if (!status && access === "none") return "other";
  }

  return null;
}

/**
 * Derive a filterable concession/free label from an Enrollments `Method` column.
 * Regular payment methods (`bank_transfer`, `card_payment`, `cash`) return "" so they don't
 * clutter the Labels column or override Concession card cross-labels.
 */
function deriveLabelFromMethod(methodRaw: string): string {
  const m = methodRaw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!m) return "";
  if (m === "free_enrollment" || m === "free_enrolment" || m === "free") return "Free enrollment";
  if (m === "free_card") return "Free card";
  if (m === "half_card") return "Half card";
  if (m === "scholarship") return "Scholarship";
  if (m === "complimentary") return "Complimentary";
  if (m === "sponsored") return "Sponsored";
  return "";
}

function isRepeatedHeader(row: string[], originalHeader: string[]): boolean {
  if (row.length < 3) return false;
  let matches = 0;
  const check = Math.min(row.length, originalHeader.length, 6);
  for (let i = 0; i < check; i++) {
    if (normHeader(row[i] ?? "") === normHeader(originalHeader[i] ?? "") && normHeader(row[i] ?? "") !== "") {
      matches++;
    }
  }
  return matches >= 3;
}

function parseAmount(raw: string): number | null {
  const withoutCommas = raw.replace(/,/g, "").trim();
  if (!withoutCommas) return null;
  // Extract the first numeric token so prefixes like "Rs. 3,000" or "LKR 3,000.00" don't include the dot in "Rs.".
  const match = withoutCommas.match(/(?:^|[^0-9.])(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function parseBoolYes(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "yes" || v === "true" || v === "1" || v === "new";
}

function slugName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function canonicalStudentKey(emailNorm: string, waNorm: string | null, mobileNorm: string | null, fullName: string): string {
  if (waNorm) return `wa:${waNorm}`;
  if (mobileNorm) return `mob:${mobileNorm}`;
  if (emailNorm) return `email:${emailNorm}`;
  return `name:${slugName(fullName)}`;
}

type RawRow = {
  fullName: string;
  studentIndex: string;
  rawEmail: string;
  emailNorm: string;
  rawWhatsapp: string;
  whatsappNorm: string | null;
  rawMobile: string;
  mobileNorm: string | null;
  institute: string;
  district: string;
  isNewStudent: boolean;
  amount: number | null;
  exportLabel: string;
  rawClasses: string;
};

/**
 * True when two student names plausibly belong to the same person (vs two siblings
 * sharing a parent's phone, like "Kasun Perera" and "Nimal Perera").
 */
export function areNamesCompatible(a: string, b: string): boolean {
  const na = a.trim().toLowerCase().replace(/[^a-z0-9\u0D80-\u0DFF\s]/g, " ").replace(/\s+/g, " ").trim();
  const nb = b.trim().toLowerCase().replace(/[^a-z0-9\u0D80-\u0DFF\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!na || !nb) return true;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const ta = na.split(" ").filter((t) => t.length >= 2);
  const tb = nb.split(" ").filter((t) => t.length >= 2);
  if (ta.length === 0 || tb.length === 0) return true;
  // Same first name (or reversed order like "Malintha Lakshan" vs "Lakshan Malintha").
  if (ta[0] === tb[0]) return true;
  const setB = new Set(tb);
  const shared = ta.filter((t) => t.length >= 3 && setB.has(t));
  return shared.length >= 2 || (shared.length === 1 && (ta.length === 1 || tb.length === 1));
}

/**
 * Deduplicate students within a single (class, month) bucket using Union-Find across
 * normalized Gmail, and normalized WhatsApp/Mobile (only merging phone matches when
 * names are compatible, so twins/siblings sharing a parent's phone stay separate!).
 * Still catches duplicates like Sethmi Bawathma (rows 10 & 28 in October).
 */
function deduplicateStudents(rawRows: RawRow[]): {
  students: ParsedStudentRecord[];
  duplicatesMerged: number;
  mergedNames: string[];
} {
  const n = rawRows.length;
  if (n === 0) return { students: [], duplicatesMerged: 0, mergedNames: [] };

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let cur = x;
    while (parent[cur] !== cur) {
      parent[cur] = parent[parent[cur]];
      cur = parent[cur];
    }
    return cur;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const byEmail = new Map<string, number>();
  const byPhone = new Map<string, number[]>();
  const byIndex = new Map<string, number[]>();

  for (let i = 0; i < n; i++) {
    const r = rawRows[i];
    if (r.emailNorm) {
      const prev = byEmail.get(r.emailNorm);
      if (prev !== undefined) union(prev, i);
      else byEmail.set(r.emailNorm, i);
    }
    for (const p of [r.whatsappNorm, r.mobileNorm]) {
      if (!p) continue;
      const list = byPhone.get(p) ?? [];
      for (const prev of list) {
        if (areNamesCompatible(rawRows[prev].fullName, r.fullName)) {
          union(prev, i);
          break;
        }
      }
      list.push(i);
      byPhone.set(p, list);
    }
    if (r.studentIndex) {
      const list = byIndex.get(r.studentIndex) ?? [];
      for (const prev of list) {
        if (areNamesCompatible(rawRows[prev].fullName, r.fullName)) {
          union(prev, i);
          break;
        }
      }
      list.push(i);
      byIndex.set(r.studentIndex, list);
    }
  }

  const buckets = new Map<number, RawRow[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = buckets.get(root) ?? [];
    list.push(rawRows[i]);
    buckets.set(root, list);
  }

  const students: ParsedStudentRecord[] = [];
  const mergedNames: string[] = [];
  let duplicatesMerged = 0;
  const usedKeys = new Set<string>();

  for (const list of buckets.values()) {
    const primary = list[0];
    if (list.length > 1) {
      duplicatesMerged += list.length - 1;
      mergedNames.push(primary.fullName);
    }

    // Merge best available fields across duplicate rows.
    const emailNorm = list.find((r) => r.emailNorm)?.emailNorm ?? "";
    const rawEmail = list.find((r) => r.rawEmail)?.rawEmail ?? "";
    const whatsappNorm = list.find((r) => r.whatsappNorm)?.whatsappNorm ?? null;
    const rawWhatsapp = list.find((r) => r.whatsappNorm)?.rawWhatsapp ?? list.find((r) => r.rawWhatsapp)?.rawWhatsapp ?? "";
    const mobileNorm = list.find((r) => r.mobileNorm)?.mobileNorm ?? null;
    const rawMobile = list.find((r) => r.mobileNorm)?.rawMobile ?? list.find((r) => r.rawMobile)?.rawMobile ?? "";
    const institute = list.find((r) => r.institute)?.institute ?? "";
    const district = list.find((r) => r.district)?.district ?? "";
    const exportLabel = [...new Set(list.map((r) => r.exportLabel).filter(Boolean))].join(" · ").slice(0, 120);
    const rawClasses = primary.rawClasses;
    const isNewStudent = list.every((r) => r.isNewStudent);
    const amounts = list.map((r) => r.amount).filter((a): a is number => a !== null);
    const amount = amounts.length > 0 ? Math.max(...amounts) : null;
    const alternateEmails = [...new Set(list.map((r) => r.emailNorm).filter((e) => e && e !== emailNorm))];

    // Ensure distinct students (e.g. siblings sharing a parent's WhatsApp) never collide on student_key.
    let key = canonicalStudentKey(emailNorm, whatsappNorm, mobileNorm, primary.fullName);
    if (usedKeys.has(key)) {
      key = emailNorm
        ? `${key}|${emailNorm}`.slice(0, 200)
        : `${key}|${slugName(primary.fullName)}`.slice(0, 200);
      let suffix = 2;
      while (usedKeys.has(key)) {
        key = `${key.slice(0, 190)}#${suffix++}`;
      }
    }
    usedKeys.add(key);

    students.push({
      student_key: key,
      full_name: primary.fullName,
      email_norm: emailNorm,
      raw_email: rawEmail,
      whatsapp_norm: whatsappNorm,
      raw_whatsapp: rawWhatsapp,
      mobile_norm: mobileNorm,
      raw_mobile: rawMobile,
      institute,
      district,
      is_new_student: isNewStudent,
      amount,
      export_label: exportLabel,
      raw_classes: rawClasses,
      mergedCount: list.length,
      alternateEmails,
    });
  }

  return { students, duplicatesMerged, mergedNames };
}

/** Extract primary student rows from a 2D table, stopping before repeated headers / Summary sections. */
function extractRowsFromTable(table: string[][]): {
  cols: ColumnMap;
  rows: string[][];
  skippedExtraSections: boolean;
} | null {
  let headerIdx = -1;
  let cols: ColumnMap | null = null;
  for (let i = 0; i < Math.min(table.length, 15); i++) {
    const detected = detectColumns(table[i]);
    if (detected) {
      headerIdx = i;
      cols = detected;
      break;
    }
  }
  if (!cols || headerIdx < 0) return null;

  const headerRow = table[headerIdx];
  const dataRows: string[][] = [];
  let skippedExtraSections = false;

  for (let i = headerIdx + 1; i < table.length; i++) {
    const row = table[i];
    if (isSummaryRow(row) || isRepeatedHeader(row, headerRow)) {
      skippedExtraSections = true;
      break;
    }
    // Skip trailing totals/blank rows where name & email & phone are all empty.
    const name = (row[cols.name] ?? "").trim();
    const email = cols.email >= 0 ? (row[cols.email] ?? "").trim() : "";
    const wa = cols.whatsapp >= 0 ? (row[cols.whatsapp] ?? "").trim() : "";
    const mob = cols.mobile >= 0 ? (row[cols.mobile] ?? "").trim() : "";
    if (!name && !email && !wa && !mob) continue;
    dataRows.push(row);
  }

  return { cols, rows: dataRows, skippedExtraSections };
}

/** Parse a 2D table (from CSV or one Excel worksheet) into class-isolated student groups. */
export function parseStudentTable(
  table: string[][],
  fileName: string,
  sheetName: string | null = null,
  extraSheetsSkipped = false,
): ParsedUploadFile {
  const extracted = extractRowsFromTable(table);
  if (!extracted) {
    throw new Error(
      'Could not find the student header row. Expected columns like "Student Name", "Gmail" (or Email), and "WhatsApp" / "Mobile".',
    );
  }

  const { cols, rows, skippedExtraSections } = extracted;
  const warnings: string[] = [];
  const fileExcluded = emptyExcludedSummary();

  type ClassAccumulator = {
    detectedName: string;
    rawSample: string;
    batchHint: string | null;
    monthNumberHint: number | null;
    rows: RawRow[];
    excludedRows: ExcludedRowsSummary;
  };
  const classBuckets = new Map<string, ClassAccumulator>();

  const getCell = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? "").trim() : "");

  for (const row of rows) {
    const fullName = getCell(row, cols.name);
    if (!fullName) continue;

    const statusRaw = getCell(row, cols.status);
    const accessStateRaw = getCell(row, cols.accessState);
    const exclusionReason = classifyRowExclusion(statusRaw, accessStateRaw);

    const rawClassesCell = getCell(row, cols.classes);
    const expectedClassCount = cols.classesCount >= 0 ? parseInt(getCell(row, cols.classesCount), 10) || undefined : undefined;
    const classParts = splitClassesCell(rawClassesCell, expectedClassCount);

    // Exclude rejected / failed / pending / revoked attempts BEFORE deduplication so failed retries
    // are never treated as paid students or counted as duplicate payments.
    if (exclusionReason) {
      recordExcluded(fileExcluded, exclusionReason, fullName);
      if (classParts.length === 0) {
        const key = "__default__";
        const bucket = classBuckets.get(key) ?? {
          detectedName: "",
          rawSample: "",
          batchHint: null,
          monthNumberHint: null,
          rows: [],
          excludedRows: emptyExcludedSummary(),
        };
        recordExcluded(bucket.excludedRows, exclusionReason, fullName);
        classBuckets.set(key, bucket);
      } else {
        const seenInRow = new Set<string>();
        for (const part of classParts) {
          const info = normalizeClassEntry(part);
          const bucketKey = info.canonicalName.toLowerCase();
          if (seenInRow.has(bucketKey)) continue;
          seenInRow.add(bucketKey);

          const bucket = classBuckets.get(bucketKey) ?? {
            detectedName: info.canonicalName,
            rawSample: part,
            batchHint: info.batchHint,
            monthNumberHint: info.monthNumber,
            rows: [],
            excludedRows: emptyExcludedSummary(),
          };
          if (!bucket.batchHint && info.batchHint) bucket.batchHint = info.batchHint;
          if (!bucket.monthNumberHint && info.monthNumber) bucket.monthNumberHint = info.monthNumber;
          recordExcluded(bucket.excludedRows, exclusionReason, fullName);
          classBuckets.set(bucketKey, bucket);
        }
      }
      continue;
    }

    const rawEmail = getCell(row, cols.email);
    const emailNorm = rawEmail.toLowerCase();
    const rawWhatsapp = getCell(row, cols.whatsapp);
    const whatsappNorm = normalizeWaPhone(rawWhatsapp);
    const rawMobile = getCell(row, cols.mobile);
    const mobileNorm = normalizeWaPhone(rawMobile);
    const institute = getCell(row, cols.institute);
    const district = getCell(row, cols.district);
    const isNewStudent = parseBoolYes(getCell(row, cols.newStudent));
    const amount = cols.amount >= 0 ? parseAmount(getCell(row, cols.amount)) : null;
    const explicitLabel = getCell(row, cols.label);
    const methodLabel = deriveLabelFromMethod(getCell(row, cols.method));
    const exportLabel = explicitLabel || methodLabel;
    const studentIndex = getCell(row, cols.studentIndex).toLowerCase();

    const baseRow: RawRow = {
      fullName,
      studentIndex,
      rawEmail,
      emailNorm,
      rawWhatsapp,
      whatsappNorm,
      rawMobile,
      mobileNorm,
      institute,
      district,
      isNewStudent,
      amount,
      exportLabel,
      rawClasses: rawClassesCell,
    };

    if (classParts.length === 0) {
      const key = "__default__";
      const bucket = classBuckets.get(key) ?? {
        detectedName: "",
        rawSample: "",
        batchHint: null,
        monthNumberHint: null,
        rows: [],
        excludedRows: emptyExcludedSummary(),
      };
      bucket.rows.push(baseRow);
      classBuckets.set(key, bucket);
      continue;
    }

    // Track per-row canonical classes so a weird duplicate string in the same row doesn't double-add.
    const seenInRow = new Set<string>();
    for (const part of classParts) {
      const info = normalizeClassEntry(part);
      const bucketKey = info.canonicalName.toLowerCase();
      if (seenInRow.has(bucketKey)) continue;
      seenInRow.add(bucketKey);

      const bucket = classBuckets.get(bucketKey) ?? {
        detectedName: info.canonicalName,
        rawSample: part,
        batchHint: info.batchHint,
        monthNumberHint: info.monthNumber,
        rows: [],
        excludedRows: emptyExcludedSummary(),
      };
      if (!bucket.batchHint && info.batchHint) bucket.batchHint = info.batchHint;
      if (!bucket.monthNumberHint && info.monthNumber) bucket.monthNumberHint = info.monthNumber;
      bucket.rows.push({ ...baseRow, rawClasses: part });
      classBuckets.set(bucketKey, bucket);
    }
  }

  const groups: DetectedClassGroup[] = [];
  for (const bucket of classBuckets.values()) {
    // Skip any class bucket that only had rejected/failed/revoked attempts and 0 valid paid students.
    if (bucket.rows.length === 0) continue;
    const { students, duplicatesMerged, mergedNames } = deduplicateStudents(bucket.rows);
    const missingPhoneCount = students.filter((s) => !s.whatsapp_norm).length;
    groups.push({
      detectedName: bucket.detectedName,
      rawSample: bucket.rawSample,
      batchHint: bucket.batchHint,
      monthNumberHint: bucket.monthNumberHint,
      rawRowCount: bucket.rows.length,
      duplicatesMerged,
      mergedNames,
      excludedRows: bucket.excludedRows,
      missingPhoneCount,
      students,
    });
  }

  // Sort largest class first.
  groups.sort((a, b) => b.students.length - a.students.length || a.detectedName.localeCompare(b.detectedName));

  const months = [...new Set(groups.map((g) => g.monthNumberHint).filter((m): m is number => m !== null))];
  const batches = [...new Set(groups.map((g) => g.batchHint).filter((b): b is string => b !== null))];
  const hasWhatsAppColumn = cols.whatsapp >= 0;

  if (!hasWhatsAppColumn && groups.length > 0) {
    warnings.push(
      'No "WhatsApp" column was found in this file. Students will still match across months via Mobile, but WhatsApp reminders only send to numbers from a "WhatsApp" column.',
    );
  }
  if (months.length > 1) {
    warnings.push("Multiple month names were detected in the Classes column. Double-check the selected month before importing.");
  }
  if (groups.length === 0) {
    warnings.push(
      fileExcluded.total > 0
        ? `No valid paid students were found — all ${fileExcluded.total} rows were excluded (${formatExcludedSummary(fileExcluded)}).`
        : "No student rows were found below the header row.",
    );
  }

  return {
    fileName,
    sheetName,
    hasWhatsAppColumn,
    skippedExtraSections: skippedExtraSections || extraSheetsSkipped,
    excludedRows: fileExcluded,
    monthNumberHint: months.length === 1 ? months[0] : months[0] ?? null,
    batchHint: batches.length === 1 ? batches[0] : batches[0] ?? null,
    groups,
    warnings,
  };
}

/** Parse CSV text into class-isolated groups. */
export function parseStudentCsv(text: string, fileName: string): ParsedUploadFile {
  return parseStudentTable(parseCsv(text), fileName, null, false);
}

/**
 * Parse an .xlsx ArrayBuffer by inspecting all sheets, skipping secondary
 * "New Students" / "Summary" sheets and selecting the full student list sheet.
 */
export async function parseStudentXlsx(buffer: ArrayBuffer, fileName: string): Promise<ParsedUploadFile> {
  const sheets = await parseXlsx(buffer);

  type Candidate = { sheetName: string; table: string[][]; rowCount: number; isNewOnlyName: boolean };
  const candidates: Candidate[] = [];

  for (const sheet of sheets) {
    const lower = sheet.name.trim().toLowerCase();
    if (/summary|metric|overview|stat|pickup|metadata/i.test(lower)) continue;
    const extracted = extractRowsFromTable(sheet.rows);
    if (!extracted || extracted.rows.length === 0) continue;
    candidates.push({
      sheetName: sheet.name,
      table: sheet.rows,
      rowCount: extracted.rows.length,
      isNewOnlyName: /\bnew\b/i.test(lower),
    });
  }

  if (candidates.length === 0) {
    throw new Error(
      'No worksheet contained a student list with "Student Name" and "Gmail"/"WhatsApp"/"Mobile" columns.',
    );
  }

  // Prefer a non-"New Students" sheet with the most rows.
  candidates.sort((a, b) => Number(a.isNewOnlyName) - Number(b.isNewOnlyName) || b.rowCount - a.rowCount);
  const best = candidates[0];
  return parseStudentTable(best.table, fileName, best.sheetName, sheets.length > 1);
}
