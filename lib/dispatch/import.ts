// Student import: detect columns, validate rows and compare them with the
// students already saved. Pure functions (no database, no network) so the
// server can re-run them at every step and they can be unit tested.

import { looksLikeFormula, normalisePhone, type PhoneStatus } from "./phone";

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
const MAX_CELL = 300;

export const STUDENT_FIELDS = [
  { key: "student_no", label: "Student number", max: 20 },
  { key: "full_name", label: "Name", max: 120 },
  { key: "address_line1", label: "Address line 1", max: 200 },
  { key: "address_line2", label: "Address line 2", max: 200 },
  { key: "address_line3", label: "Address line 3", max: 200 },
  { key: "city", label: "City", max: 60 },
  { key: "region", label: "Region", max: 60 },
  { key: "phone1", label: "Phone 1", max: 40 },
  { key: "phone2", label: "Phone 2", max: 40 },
  { key: "delivery_note", label: "Delivery note", max: 300 },
] as const;

export type FieldKey = (typeof STUDENT_FIELDS)[number]["key"];
export type ColumnSource = { column: number; fromReference?: boolean };
export type Mapping = Partial<Record<FieldKey, ColumnSource>>;

/** A sheet as text: header row, data rows, and which cells held formulas. */
export type Sheet = { header: string[]; rows: string[][]; formula: boolean[][] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Header names we recognise, best first. Citypak's names are exact. */
const KNOWN: Record<FieldKey, string[]> = {
  student_no: ["student no", "student number", "student id", "index no", "index number", "reg no", "registration number"],
  full_name: ["receiver s address name", "full name", "student name", "name"],
  address_line1: ["receiver s address line 1", "address line 1", "address 1", "address"],
  address_line2: ["receiver s address line 2", "address line 2", "address 2"],
  address_line3: ["receiver s address line 3", "address line 3", "address 3"],
  city: ["receiver s address line 4 city", "city", "town"],
  region: ["region", "district", "province"],
  phone1: ["receiver s contact number 1", "phone 1", "phone", "mobile", "contact number", "whatsapp"],
  phone2: ["receiver s contact number 2", "phone 2", "mobile 2", "contact number 2"],
  delivery_note: ["delivery note", "delivery instructions", "note"],
};

/** Guess which column feeds each field. "Your Reference" gives the student number (its last digits). */
export function detectMapping(header: string[]): Mapping {
  const names = header.map(norm);
  const used = new Set<number>();
  const mapping: Mapping = {};
  for (const field of STUDENT_FIELDS) {
    for (const candidate of KNOWN[field.key]) {
      const i = names.findIndex((n, idx) => n === candidate && !used.has(idx));
      if (i >= 0) {
        mapping[field.key] = { column: i };
        used.add(i);
        break;
      }
    }
  }
  if (!mapping.student_no) {
    const ref = names.indexOf("your reference");
    if (ref >= 0) mapping.student_no = { column: ref, fromReference: true };
  }
  return mapping;
}

/** The student number inside a reference: its trailing digits ("27TGROCTICT088" → "088"). */
export function studentNoFromReference(reference: string): string | null {
  const m = reference.trim().match(/(\d+)$/);
  return m ? m[1] : null;
}

export type Candidate = {
  /** 1-based row number in the file (header = row 1). */
  line: number;
  values: Partial<Record<FieldKey, string>>;
  phone1Raw: string | null;
  phoneStatus: Partial<Record<"phone1" | "phone2", PhoneStatus>>;
  errors: string[];
  warnings: string[];
};

const STUDENT_NO = /^[0-9A-Za-z][0-9A-Za-z-]{0,19}$/;

/** Turn sheet rows into checked candidates (no database needed). */
export function buildCandidates(sheet: Sheet, mapping: Mapping): Candidate[] {
  const out: Candidate[] = [];
  sheet.rows.forEach((row, r) => {
    if (row.every((c) => (c ?? "").trim() === "")) return; // blank line
    const c: Candidate = { line: r + 2, values: {}, phone1Raw: null, phoneStatus: {}, errors: [], warnings: [] };

    for (const field of STUDENT_FIELDS) {
      const src = mapping[field.key];
      if (!src) continue;
      let text = (row[src.column] ?? "").replace(/\s+/g, " ").trim();
      if (sheet.formula[r]?.[src.column]) c.warnings.push(`${field.label} came from a formula`);

      if (field.key === "phone1" || field.key === "phone2") {
        const p = normalisePhone(text);
        c.phoneStatus[field.key] = p.status;
        if (field.key === "phone1") c.phone1Raw = p.raw || null;
        if (p.status === "review" || p.status === "invalid") c.warnings.push(`${field.label}: ${p.note}`);
        c.values[field.key] = p.value ?? "";
        continue;
      }
      if (looksLikeFormula(text)) {
        c.warnings.push(`${field.label} started with "${text[0]}" (removed)`);
        text = text.replace(/^[=@\t\r]+/, "").trim();
      }
      if (field.key === "student_no" && src.fromReference) {
        const no = studentNoFromReference(text);
        if (!no) c.errors.push(`No student number at the end of reference "${text.slice(0, 40)}"`);
        text = no ?? "";
      }
      if (field.key === "student_no") text = text.toUpperCase();
      if (text.length > Math.min(field.max, MAX_CELL)) {
        c.errors.push(`${field.label} is too long (max ${field.max})`);
        text = text.slice(0, field.max);
      }
      c.values[field.key] = text;
    }

    if (!c.values.student_no) c.errors.push("Missing student number");
    else if (!STUDENT_NO.test(c.values.student_no)) c.errors.push(`Student number "${c.values.student_no}" has characters that are not allowed`);
    if (!c.values.full_name) c.errors.push("Missing name");
    if (mapping.address_line1 && !c.values.address_line1) c.warnings.push("Missing address");
    if (mapping.city && !c.values.city) c.warnings.push("Missing city");
    out.push(c);
  });

  // The same student number twice in one file: we can't tell which is right.
  const counts = new Map<string, number>();
  for (const c of out) if (c.values.student_no) counts.set(c.values.student_no, (counts.get(c.values.student_no) ?? 0) + 1);
  for (const c of out) {
    if (c.values.student_no && (counts.get(c.values.student_no) ?? 0) > 1) {
      c.errors.push(`Student number ${c.values.student_no} appears more than once in the file`);
    }
  }

  // Same person under two numbers (same name and phone): flag for a look.
  const key = (name?: string, phone?: string) => (name && phone ? `${name.toLowerCase()}|${phone}` : null);
  const seen = new Map<string, string>();
  for (const c of out) {
    const k = key(c.values.full_name, c.values.phone1);
    if (!k) continue;
    const other = seen.get(k);
    if (other && other !== c.values.student_no) c.warnings.push(`Same name and phone as student ${other}`);
    else seen.set(k, c.values.student_no ?? "");
  }
  return out;
}

export type ExistingStudent = {
  id: string;
  student_no: string;
  full_name: string;
  address_line1: string;
  address_line2: string;
  address_line3: string;
  city: string;
  region: string;
  phone1: string | null;
  phone2: string | null;
  delivery_note: string;
  updated_at: string;
  anonymised_at: string | null;
};

export type RowStatus = "new" | "updated" | "unchanged" | "review" | "invalid";
export type Change = { field: FieldKey; label: string; from: string; to: string };

export type PreviewRow = {
  line: number;
  studentNo: string;
  name: string;
  status: RowStatus;
  /** Why it is "review" (it may also be new or an update underneath). */
  baseStatus: "new" | "updated" | "unchanged" | "invalid";
  changes: Change[];
  errors: string[];
  warnings: string[];
  /** Ticked by default in the preview. */
  defaultSelected: boolean;
  /** What would be sent to the database if this row is approved. */
  apply: Record<string, string> | null;
};

const IMPORTANT: FieldKey[] = ["address_line1", "address_line2", "address_line3", "city", "phone1", "phone2"];

/** Compare candidates with saved students and decide what each row would do. */
export function classify(candidates: Candidate[], existing: ExistingStudent[], mapping: Mapping): PreviewRow[] {
  const byNo = new Map(existing.map((s) => [s.student_no, s]));
  const byNamePhone = new Map(
    existing.filter((s) => s.phone1).map((s) => [`${s.full_name.toLowerCase()}|${s.phone1}`, s.student_no]),
  );
  const mapped = STUDENT_FIELDS.filter((f) => mapping[f.key] && f.key !== "student_no");

  return candidates.map((c) => {
    const studentNo = c.values.student_no ?? "";
    const base = {
      line: c.line,
      studentNo,
      name: c.values.full_name ?? "",
      errors: [...c.errors],
      warnings: [...c.warnings],
    };
    if (base.errors.length > 0) {
      return { ...base, status: "invalid", baseStatus: "invalid", changes: [], defaultSelected: false, apply: null };
    }

    const current = byNo.get(studentNo);
    const twin = c.values.phone1 ? byNamePhone.get(`${(c.values.full_name ?? "").toLowerCase()}|${c.values.phone1}`) : undefined;
    if (twin && twin !== studentNo) base.warnings.push(`Same name and phone as saved student ${twin}`);

    if (!current) {
      const apply: Record<string, string> = { action: "new", student_no: studentNo };
      for (const f of mapped) apply[f.key] = c.values[f.key] ?? "";
      if (c.phone1Raw && mapping.phone1) apply.phone1_raw = c.phone1Raw;
      const review = base.warnings.length > 0;
      return {
        ...base,
        status: review ? "review" : "new",
        baseStatus: "new",
        changes: [],
        defaultSelected: !review,
        apply,
      };
    }
    if (current.anonymised_at) {
      return {
        ...base,
        errors: ["This student's details were anonymised and can't be changed"],
        status: "invalid",
        baseStatus: "invalid",
        changes: [],
        defaultSelected: false,
        apply: null,
      };
    }

    // Never blank out saved details: an empty cell means "no change".
    const changes: Change[] = [];
    const apply: Record<string, string> = { action: "update", student_no: studentNo, expected_updated_at: current.updated_at };
    for (const f of mapped) {
      const to = c.values[f.key] ?? "";
      const from = (current[f.key as keyof ExistingStudent] as string | null) ?? "";
      if (to === "" || to === from) continue;
      changes.push({ field: f.key, label: f.label, from, to });
      apply[f.key] = to;
      if (f.key === "phone1" && c.phone1Raw) apply.phone1_raw = c.phone1Raw;
    }
    if (changes.length === 0) {
      return { ...base, status: "unchanged", baseStatus: "unchanged", changes, defaultSelected: false, apply: null };
    }
    // Changes to where a parcel goes are never pre-ticked.
    const touchesDelivery = changes.some((ch) => IMPORTANT.includes(ch.field));
    const review = base.warnings.length > 0;
    return {
      ...base,
      status: review ? "review" : "updated",
      baseStatus: "updated",
      changes,
      defaultSelected: !review && !touchesDelivery,
      apply,
    };
  });
}

export function countByStatus(rows: PreviewRow[]): Record<RowStatus, number> {
  const counts: Record<RowStatus, number> = { new: 0, updated: 0, unchanged: 0, review: 0, invalid: 0 };
  for (const r of rows) counts[r.status] += 1;
  return counts;
}

/** Make a value safe to open in Excel (no formulas). */
export function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** CSV of the rows that need attention, for download. */
export function issuesCsv(rows: PreviewRow[]): string {
  const esc = (v: string) => {
    const s = safeCell(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Row", "Student number", "Name", "Status", "Problems"].join(",")];
  for (const r of rows) {
    if (r.errors.length === 0 && r.warnings.length === 0) continue;
    lines.push([String(r.line), r.studentNo, r.name, r.status, [...r.errors, ...r.warnings].join("; ")].map(esc).join(","));
  }
  return lines.join("\r\n");
}

/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A sheet from CSV rows: the first non-empty row is the header. */
export function sheetFromMatrix(matrix: string[][], formula?: boolean[][]): Sheet {
  const start = matrix.findIndex((r) => r.filter((c) => (c ?? "").trim() !== "").length >= 2);
  if (start < 0) return { header: [], rows: [], formula: [] };
  const header = matrix[start].map((h) => (h ?? "").trim());
  const rows = matrix.slice(start + 1).map((r) => header.map((_, i) => (r[i] ?? "").slice(0, MAX_CELL * 2)));
  const f = (formula ?? []).slice(start + 1).map((r) => header.map((_, i) => Boolean(r?.[i])));
  return { header, rows, formula: f };
}
