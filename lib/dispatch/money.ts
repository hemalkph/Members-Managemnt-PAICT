// COD money helpers shared by the pages. The database decides what is owed
// and paid (dispatch_cod_rows); these only label and read input.

export type CodStatus = "voided" | "waiting" | "in_draft" | "over" | "nothing_due" | "settled" | "unpaid" | "part_paid";

export const COD_STATUS: Record<CodStatus, { label: string; variant: "secondary" | "outline" | "success" | "warning" | "destructive" | "default" }> = {
  waiting: { label: "Not delivered yet", variant: "outline" },
  unpaid: { label: "Unpaid", variant: "warning" },
  part_paid: { label: "Part paid", variant: "warning" },
  in_draft: { label: "In a draft settlement", variant: "default" },
  settled: { label: "Settled", variant: "success" },
  nothing_due: { label: "Nothing due", variant: "secondary" },
  over: { label: "Paid too much – check", variant: "destructive" },
  voided: { label: "Voided", variant: "secondary" },
};

export const SETTLEMENT_STATE = {
  draft: { label: "Draft", variant: "outline" },
  confirmed: { label: "Confirmed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
} as const;

export type PaymentRow = { code: string; collected?: number; fee?: number };
export type PaymentParse = { rows: PaymentRow[]; errors: { line: number; text: string; message: string }[] };

const MAX_ROWS = 2000;

function amount(token: string | undefined): number | undefined | null {
  if (token === undefined || token === "") return undefined;
  const clean = token.replace(/^(rs\.?|lkr)/i, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const n = Number(clean);
  return n <= 1_000_000 ? n : null;
}

/**
 * Reads a pasted list, one parcel per line: tracking number or reference,
 * then optionally the amount collected and the fee. Tabs, spaces, ";" or ","
 * separate the parts (copied from a spreadsheet works). Lines are not saved
 * here; the database checks every code again.
 */
export function parsePaymentLines(text: string): PaymentParse {
  const rows: PaymentRow[] = [];
  const errors: PaymentParse["errors"] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let parts = line.split(/[\t;|]+|\s+/).filter(Boolean);
    // "D16950069,1500,20" (comma separated, no spaces)
    if (parts.length === 1 && parts[0].includes(",")) parts = parts[0].split(",");
    // A header row such as "Tracking  Amount  Fee" (no digits at all) is skipped quietly.
    if (rows.length === 0 && errors.length === 0 && !/\d/.test(line)) return;
    const code = parts[0].toUpperCase();
    if (!/^[A-Z0-9]{2,40}$/.test(code)) {
      errors.push({ line: i + 1, text: line, message: "Not a tracking number or reference" });
      return;
    }
    const collected = amount(parts[1]);
    const fee = amount(parts[2]);
    if (collected === null || fee === null) {
      errors.push({ line: i + 1, text: line, message: "The amount is not a number" });
      return;
    }
    if (seen.has(code)) {
      errors.push({ line: i + 1, text: line, message: "Listed twice" });
      return;
    }
    seen.add(code);
    rows.push({ code, ...(collected !== undefined ? { collected } : {}), ...(fee !== undefined ? { fee } : {}) });
  });
  if (rows.length > MAX_ROWS) {
    return { rows: rows.slice(0, MAX_ROWS), errors: [...errors, { line: 0, text: "", message: `Only the first ${MAX_ROWS} parcels are used` }] };
  }
  return { rows, errors };
}

/** Text that a spreadsheet could run as a formula is stored as plain text. */
export function safeCell(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** The month range in the URL (yyyy-mm), defaulting to the last three months. */
export function reportRange(from: string | undefined, to: string | undefined, now = new Date()): { from: string; to: string } {
  const ok = (v: string | undefined) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);
  const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const end = ok(to) ?? ym(now);
  const start = ok(from) ?? ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)));
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

/** "2026-11" → first day of that month; anything else → null. */
export function monthStart(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return `${value}-01`;
}
