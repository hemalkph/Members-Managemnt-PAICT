// CSV import of concession students and their past payments: the templates
// and the row checks behind the preview. Pure (runs in the browser); the
// database checks the same rules again when the rows are saved.

import { concessionGuardianSchema, concessionStudentSchema, slPhone } from "@/lib/core/validation";
import type { ConcessionCard, ConcessionStatus } from "@/lib/supabase/database.types";
import { CARD_LABEL, STATUS_LABEL } from "@/lib/students/rules";

export const MAX_IMPORT_ROWS = 1000;

const PARENT_FIELDS = ["relationship", "name", "occupation", "phone"] as const;
export const STUDENT_COLUMNS = [
  "student_id",
  "full_name",
  "batch",
  "centre",
  "card_type",
  "gn_division",
  "certificate_date",
  "monthly_amount",
  "consent_date",
  "reason",
  ...PARENT_FIELDS.map((f) => `parent1_${f}`),
  ...PARENT_FIELDS.map((f) => `parent2_${f}`),
];
export const PAYMENT_COLUMNS = ["student_id", "month", "status", "amount", "paid_on", "note"];

/** Rows whose student ID is this are the template's example and are ignored. */
export const EXAMPLE_ID = "EXAMPLE";

export function studentTemplate(batch = "2027 A/L", centre = "Online"): string[][] {
  return [
    STUDENT_COLUMNS,
    [
      EXAMPLE_ID, "Nimal Perera", batch, centre, "half", "628B Kotigamgoda, Horana", "2026-11-01", "1500", "2026-11-01",
      "Father lost his job", "mother", "Kumari Perera", "Teacher", "0771234567", "father", "Sunil Perera", "Driver", "",
    ],
  ];
}

export function paymentTemplate(): string[][] {
  return [PAYMENT_COLUMNS, [EXAMPLE_ID, "2026-10", "paid", "1500", "2026-10-05", ""]];
}

const pad = (n: number) => String(n).padStart(2, "0");
function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/**
 * "2026-11-15", or Excel's "15/11/2026" / "15-11-2026" / "15.11.2026" (day first,
 * as in Sri Lanka). "" stays "". Null when it isn't a real date.
 */
export function readDate(value: string): string | null {
  const v = value.trim();
  if (v === "") return "";
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  return null;
}

/** "2026-10", "2026-10-01", "10/2026" or any date in the month → "2026-10". Null otherwise. */
export function readMonth(value: string): string | null {
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(+m[2])}`;
  m = v.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}`;
  const d = readDate(v);
  return d ? d.slice(0, 7) : null;
}

/** Phone numbers Excel turned into 771234567 get their 0 back. */
export function readPhone(value: string): string {
  const p = slPhone(value.trim());
  return /^[1-9]\d{8}$/.test(p) ? `0${p}` : p;
}

/** Reads the header row: column name → index. Lists required columns that are missing. */
function columns(header: string[], required: string[]) {
  const index = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  return { index, missing: required.filter((c) => !index.has(c)) };
}

const byName = <T extends { name: string }>(list: T[]) => new Map(list.map((x) => [x.name.trim().toLowerCase(), x]));

export type StudentPayload = {
  student_no: string;
  full_name: string;
  batch_id: string;
  centre_id: string;
  card_type: ConcessionCard;
  gn_division: string;
  certificate_issued_on: string;
  reason: string;
  monthly_amount: string;
  consent_on: string;
  guardians: { relationship: "mother" | "father" | "guardian"; full_name: string; occupation: string; phone: string }[];
};

export type ExistingStudent = {
  id: string;
  studentNo: string;
  fullName: string;
  batchName: string;
  centreName: string | null;
  card: ConcessionCard;
  status: ConcessionStatus;
};

export type PreviewRow<P> =
  | { line: number; key: string; summary: string; kind: "new"; payload: P }
  | { line: number; key: string; summary: string; kind: "existing"; existing: string }
  | { line: number; key: string; summary: string; kind: "error"; errors: string[] };

export type Preview<P> = { fileError: string | null; rows: PreviewRow<P>[]; ignored: number };

export function checkStudentRows(
  table: string[][],
  ctx: { batches: { id: string; name: string }[]; centres: { id: string; name: string }[]; existing: ExistingStudent[] },
): Preview<StudentPayload> {
  if (table.length === 0) return { fileError: "The file is empty.", rows: [], ignored: 0 };
  const { index, missing } = columns(table[0], ["student_id", "full_name", "batch", "card_type"]);
  if (missing.length) {
    return { fileError: `Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Start from the template.`, rows: [], ignored: 0 };
  }
  if (table.length - 1 > MAX_IMPORT_ROWS) {
    return { fileError: `Import at most ${MAX_IMPORT_ROWS.toLocaleString("en")} students at a time.`, rows: [], ignored: 0 };
  }
  const batches = byName(ctx.batches);
  const centres = byName(ctx.centres);
  const existing = new Map(ctx.existing.map((s) => [s.studentNo, s]));
  const seen = new Set<string>();
  const rows: PreviewRow<StudentPayload>[] = [];
  let ignored = 0;

  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (col: string) => (index.has(col) ? (cells[index.get(col)!] ?? "").trim() : "");
    const studentNo = get("student_id").toUpperCase();
    if (studentNo === EXAMPLE_ID) {
      ignored++;
      return;
    }
    const card = get("card_type").toLowerCase().replace(/\s*card$/, "");
    const summary = [get("full_name") || "—", get("batch"), CARD_LABEL[card as ConcessionCard] ?? get("card_type")].filter(Boolean).join(" · ");
    const key = studentNo || `line ${line}`;

    const already = existing.get(studentNo);
    if (already) {
      rows.push({
        line,
        key,
        summary,
        kind: "existing",
        existing: [already.fullName, already.batchName, CARD_LABEL[already.card], STATUS_LABEL[already.status], already.centreName]
          .filter(Boolean)
          .join(" · "),
      });
      return;
    }

    const errors: string[] = [];
    if (studentNo && seen.has(studentNo)) errors.push(`Student ID ${studentNo} is in the file twice`);
    if (studentNo) seen.add(studentNo);

    const batch = batches.get(get("batch").toLowerCase());
    if (get("batch") && !batch) errors.push(`Batch "${get("batch")}" not found`);
    const centre = get("centre") ? centres.get(get("centre").toLowerCase()) : undefined;
    if (get("centre") && !centre) errors.push(`Centre "${get("centre")}" not found`);

    const dates = { certificate_date: readDate(get("certificate_date")), consent_date: readDate(get("consent_date")) };
    for (const [col, v] of Object.entries(dates)) if (v === null) errors.push(`${col}: use YYYY-MM-DD, e.g. 2026-11-15`);

    const student = concessionStudentSchema.safeParse({
      student_no: studentNo,
      full_name: get("full_name"),
      batch_id: batch?.id ?? "00000000-0000-4000-8000-000000000000",
      centre_id: centre?.id ?? "",
      card_type: card,
      gn_division: get("gn_division"),
      certificate_issued_on: dates.certificate_date ?? "",
      reason: get("reason"),
      monthly_amount: card === "free" ? "" : get("monthly_amount").replace(/,/g, ""),
      consent_on: dates.consent_date ?? "",
    });
    if (!student.success) {
      for (const issue of student.error.issues) {
        if (issue.path[0] === "batch_id") continue; // reported above
        errors.push(issue.path[0] === "card_type" ? "card_type must be free, half or paid" : issue.message);
      }
    }

    const guardians: StudentPayload["guardians"] = [];
    for (const n of [1, 2]) {
      const f = (field: string) => get(`parent${n}_${field}`);
      if (!PARENT_FIELDS.some((x) => f(x))) continue;
      const g = concessionGuardianSchema.safeParse({
        student_id: "00000000-0000-4000-8000-000000000000",
        relationship: f("relationship").toLowerCase(),
        full_name: f("name"),
        occupation: f("occupation"),
        phone: readPhone(f("phone")),
      });
      if (g.success) {
        guardians.push({ relationship: g.data.relationship, full_name: g.data.full_name, occupation: g.data.occupation, phone: g.data.phone });
      } else {
        for (const issue of g.error.issues) {
          errors.push(`Parent ${n}: ${issue.path[0] === "relationship" ? "relationship must be mother, father or guardian" : issue.message}`);
        }
      }
    }

    if (errors.length || !student.success || !batch) {
      rows.push({ line, key, summary, kind: "error", errors });
      return;
    }
    const v = student.data;
    rows.push({
      line,
      key,
      summary,
      kind: "new",
      payload: {
        student_no: v.student_no,
        full_name: v.full_name,
        batch_id: v.batch_id,
        centre_id: v.centre_id,
        card_type: v.card_type,
        gn_division: v.gn_division,
        certificate_issued_on: v.certificate_issued_on,
        reason: v.reason,
        monthly_amount: v.monthly_amount,
        consent_on: v.consent_on,
        guardians,
      },
    });
  });
  return { fileError: null, rows, ignored };
}

export type PaymentPayload = {
  student_id: string;
  month: string;
  status: "paid" | "unpaid";
  amount: string;
  paid_on: string;
  note: string;
};

export function checkPaymentRows(
  table: string[][],
  ctx: {
    students: { id: string; studentNo: string; fullName: string; card: ConcessionCard }[];
    /** "<student id>:<YYYY-MM>" → what is recorded. */
    existing: Map<string, { status: "paid" | "unpaid"; amount: number | null }>;
    /** This calendar month, "YYYY-MM". */
    thisMonth: string;
  },
): Preview<PaymentPayload> {
  if (table.length === 0) return { fileError: "The file is empty.", rows: [], ignored: 0 };
  const { index, missing } = columns(table[0], ["student_id", "month", "status"]);
  if (missing.length) {
    return { fileError: `Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Start from the template.`, rows: [], ignored: 0 };
  }
  if (table.length - 1 > MAX_IMPORT_ROWS) {
    return { fileError: `Import at most ${MAX_IMPORT_ROWS.toLocaleString("en")} payments at a time.`, rows: [], ignored: 0 };
  }
  const students = new Map(ctx.students.map((s) => [s.studentNo, s]));
  const seen = new Set<string>();
  const rows: PreviewRow<PaymentPayload>[] = [];
  let ignored = 0;
  const money = (n: number | null) => (n === null ? "" : ` Rs. ${n.toLocaleString("en")}`);

  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (col: string) => (index.has(col) ? (cells[index.get(col)!] ?? "").trim() : "");
    const studentNo = get("student_id").toUpperCase();
    if (studentNo === EXAMPLE_ID) {
      ignored++;
      return;
    }
    const s = students.get(studentNo);
    const month = readMonth(get("month"));
    const status = get("status").toLowerCase();
    const amount = get("amount").replace(/,/g, "");
    const paidOn = readDate(get("paid_on"));
    const summary = [s?.fullName ?? studentNo, get("month"), status, amount && `Rs. ${amount}`].filter(Boolean).join(" · ");
    const key = `${studentNo}·${month ?? get("month")}`;

    const errors: string[] = [];
    if (!s) errors.push(`Student ID "${studentNo}" is not registered`);
    else if (s.card === "free") errors.push("A Free card student pays nothing");
    if (!month) errors.push("month: use YYYY-MM, e.g. 2026-10");
    else if (month > ctx.thisMonth) errors.push("The month is in the future");
    if (status !== "paid" && status !== "unpaid") errors.push("status must be paid or unpaid");
    if (status === "paid" && !/^\d{1,7}(\.\d{1,2})?$/.test(amount)) errors.push("Enter the amount paid in rupees");
    if (paidOn === null) errors.push("paid_on: use YYYY-MM-DD");
    if (get("note").length > 300) errors.push("The note is longer than 300 characters");
    if (s && month) {
      if (seen.has(`${s.id}:${month}`)) errors.push("This student and month are in the file twice");
      seen.add(`${s.id}:${month}`);
    }

    if (errors.length) {
      rows.push({ line, key, summary, kind: "error", errors });
      return;
    }
    const recorded = ctx.existing.get(`${s!.id}:${month}`);
    if (recorded) {
      rows.push({ line, key, summary, kind: "existing", existing: `${recorded.status === "paid" ? "Paid" : "Unpaid"}${money(recorded.amount)}` });
      return;
    }
    rows.push({
      line,
      key,
      summary,
      kind: "new",
      payload: {
        student_id: s!.id,
        month: month!,
        status: status as "paid" | "unpaid",
        amount: status === "paid" ? amount : "",
        paid_on: status === "paid" ? paidOn! : "",
        note: get("note"),
      },
    });
  });
  return { fileError: null, rows, ignored };
}
