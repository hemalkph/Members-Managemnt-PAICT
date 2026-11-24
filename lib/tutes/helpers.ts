import { formatDate, formatDateTime } from "@/lib/core/format";
import { monthLabel } from "@/lib/core/month";
import { toCsv } from "@/lib/students/csv";
import type { TuteClassNeed, TuteForecastMethod, TuteMoveKind, TuteStockRow } from "@/lib/supabase/database.types";
import type { TuteMove, TutePrinter, TutePrintJob } from "@/lib/tutes/queries";

export const METHOD_LABEL: Record<TuteForecastMethod, string> = {
  last_month: "same as last month",
  avg3: "3-month average",
  smooth: "smoothed average",
  trend: "trend",
  start_rule: "pay-again rate + new students",
  none: "no paid lists yet",
};

export const MOVE_KIND_LABEL: Record<TuteMoveKind, string> = {
  opening_stock: "Opening stock",
  print_in: "Printed",
  class_issue: "Given to class",
  post_out: "Posted",
  return_in: "Returned",
  damaged: "Damaged",
  count_fix: "Count fix",
};

export function leftThisMonth(r: Pick<TuteStockRow, "need_this" | "given_this">): number {
  return Math.max(r.need_this - r.given_this, 0);
}

/** Hall copies still left to hand out for a class (excludes Online students who go by Speed Post). */
export function hallRemaining(c: Pick<TuteClassNeed, "expected" | "online" | "given" | "hall_given">): number {
  if (c.online > 0) {
    const hallExpected = Math.max(c.expected - c.online, 0);
    const hallGiven = c.hall_given ?? 0;
    return Math.max(hallExpected - hallGiven, 0);
  }
  return Math.max(c.expected - c.given, 0);
}

/** Add days to an ISO calendar date ("YYYY-MM-DD") without timezone drift. */
export function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Pick the best default active printer for a tute: its last printer, else batch's latest, else first active. */
export function defaultPrinterIdFor(
  tuteId: string,
  jobs: Pick<TutePrintJob, "tuteId" | "printerId">[],
  activePrinters: Pick<TutePrinter, "id">[],
): string {
  if (activePrinters.length === 0) return "none";
  const activeIds = new Set(activePrinters.map((p) => p.id));
  const lastForTute = jobs.find((j) => j.tuteId === tuteId && j.printerId && activeIds.has(j.printerId));
  if (lastForTute?.printerId) return lastForTute.printerId;
  const lastInBatch = jobs.find((j) => j.printerId && activeIds.has(j.printerId));
  if (lastInBatch?.printerId) return lastInBatch.printerId;
  return activePrinters[0].id;
}

/** Format a clean plain-text print order ready to paste into WhatsApp for the press. */
export function formatPressOrderText(
  items: Pick<TuteStockRow, "name" | "code" | "pages" | "print_now" | "print_by">[],
  month: string,
  today: string,
): string {
  const active = items.filter((i) => i.print_now > 0);
  if (active.length === 0) return "";
  const totalCopies = active.reduce((sum, i) => sum + i.print_now, 0);
  const lines = active.map((i, idx) => {
    const code = i.code ? ` [${i.code}]` : "";
    const pages = i.pages ? ` (${i.pages} pages)` : "";
    const urgency = i.print_by && i.print_by <= today ? " — URGENT" : i.print_by ? ` — by ${formatDate(i.print_by)}` : "";
    return `${idx + 1}. ${i.name}${code}${pages} — ${i.print_now} copies${urgency}`;
  });
  return [
    `Print Order — ${monthLabel(month)} (${active.length} tute${active.length === 1 ? "" : "s"}, ${totalCopies} copies)`,
    "",
    ...lines,
  ].join("\n");
}

/** Convert stock movement rows to a spreadsheet-safe CSV string. */
export function historyToCsv(moves: TuteMove[]): string {
  const header = ["When", "Tute", "Change", "Type", "Class", "Month", "Note", "Odd Flag", "By"];
  const body = moves.map((m) => [
    formatDateTime(m.createdAt),
    m.tuteName,
    m.qty > 0 ? `+${m.qty}` : String(m.qty),
    MOVE_KIND_LABEL[m.kind],
    m.className ?? "",
    m.month ? monthLabel(m.month.slice(0, 7), "short") : "",
    m.note,
    m.flag,
    m.by,
  ]);
  return toCsv([header, ...body]);
}

export type TuteBookletKind = "paper" | "note" | "book" | "tute";

/** Classify a printed booklet from its title and short code for tactile shelf emblems. */
export function inferTuteKind(name: string, code: string): TuteBookletKind {
  const text = `${name} ${code}`;
  if (/short\s*note|\bsn\b|-sn$/i.test(text)) return "note";
  if (/question\s*book|workbook|\bbook\b|\bqb\b|ttqb/i.test(text)) return "book";
  if (/paper|provincial|past|discussion|mcq|essay|\b\d{4}(wp|nwp|sp|cp|ep|ncp|sab|uva|np)\b/i.test(text)) {
    return "paper";
  }
  return "tute";
}

/** Compact spine code for the mini booklet emblem (uses explicit code, else clean initials). */
export function bookletBadgeCode(code: string, name: string): string {
  const trimmed = code.trim();
  if (trimmed) return trimmed.slice(0, 8);
  const words = name
    .trim()
    .split(/[\s\-–—/]+/)
    .filter(Boolean);
  if (words.length === 0) return "TUTE";
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  const unitMatch = name.match(/\b(unit|lesson|ch(?:apter)?)\s*0?(\d+)/i);
  if (unitMatch) return `${unitMatch[1][0].toUpperCase()}${unitMatch[2].padStart(2, "0")}`;
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/**
 * Split a booklet code onto 1 or 2 crisp lines so codes like "2023NWP", "L01-SN",
 * or "28TTQB" never clip with "..." inside a portrait mini-booklet emblem.
 */
export function bookletBadgeLines(code: string, name: string): [string, string | null] {
  const raw = bookletBadgeCode(code, name);
  if (raw.length <= 4) return [raw, null];
  const sep = raw.split(/[-_\s/]+/).filter(Boolean);
  if (sep.length >= 2) return [sep[0].slice(0, 4), sep.slice(1).join("").slice(0, 4)];
  const numPrefix = raw.match(/^(\d{2,4})([A-Za-z].*)$/);
  if (numPrefix) return [numPrefix[1], numPrefix[2].slice(0, 4)];
  const alphaPrefix = raw.match(/^([A-Za-z]{1,4})(\d+.*)$/);
  if (alphaPrefix) return [alphaPrefix[1], alphaPrefix[2].slice(0, 4)];
  return [raw.slice(0, 4), raw.slice(4, 8) || null];
}

export type ShelfVerdictTone = "destructive" | "warning" | "success" | "info" | "muted";

/** One-glance shelf verdict telling the coordinator what's true without mental math. */
export function shelfVerdict(
  r: Pick<TuteStockRow, "status" | "on_hand" | "in_print" | "need_this" | "given_this" | "need_next" | "print_now">,
): { label: string; tone: ShelfVerdictTone } {
  if (r.status === "not_counted") return { label: "Needs shelf count", tone: "muted" };
  if (r.status === "not_scheduled") {
    return {
      label: r.on_hand > 0 ? `${r.on_hand} on shelf` : "Not scheduled",
      tone: "muted",
    };
  }
  const left = leftThisMonth(r);
  if (left === 0 && r.need_this > 0 && r.need_next === 0) {
    return { label: r.on_hand > 0 ? `Done · ${r.on_hand} spare` : "Month complete", tone: "success" };
  }
  if (r.status === "out") {
    const gap = Math.max(left + r.need_next - r.on_hand - r.in_print, left);
    return { label: gap > 0 ? `Short ${gap}` : "Out of stock", tone: "destructive" };
  }
  if (r.status === "low") {
    if (r.on_hand < left && r.in_print > 0 && r.print_now === 0) {
      return { label: `+${r.in_print} at press`, tone: "info" };
    }
    const gap = Math.max(left + r.need_next - r.on_hand - r.in_print, 0);
    return {
      label: gap > 0 ? `Short ${gap}` : r.print_now > 0 ? `Order ${r.print_now}` : "Running low",
      tone: "warning",
    };
  }
  const spare = Math.max(r.on_hand - left, 0);
  return { label: spare > 0 ? `Ready · ${spare} spare` : "Covered", tone: "success" };
}

/** Where a class's expected students come from, in words ("forecast (same as last month) · 103 paid so far"). */
export function needSource(c: Pick<TuteClassNeed, "expected" | "paid" | "pace" | "method">): string {
  if (c.paid !== null && c.expected === c.paid) return "the paid list";
  const soFar = c.paid !== null ? ` · ${c.paid} paid so far` : "";
  if (c.pace !== null && c.expected === c.pace) return `month-end estimate from payment pace${soFar}`;
  return `forecast (${METHOD_LABEL[c.method]})${soFar}`;
}

/** How the Order number is made: "143 still to give + 8 spare = 151". */
export function orderBreakdown(
  r: Pick<
    TuteStockRow,
    "need_this" | "given_this" | "need_next" | "safety" | "loss_extra" | "on_hand" | "in_print" | "print_batch" | "print_now"
  >,
): string {
  const parts = [`${leftThisMonth(r)} still to give`];
  if (r.need_next > 0) parts.push(`+ ${r.need_next} next month`);
  if (r.safety > 0) parts.push(`+ ${r.safety} spare`);
  if (r.loss_extra > 0) parts.push(`+ ${r.loss_extra} for losses`);
  if (r.on_hand > 0) parts.push(`− ${r.on_hand} on shelf`);
  if (r.in_print > 0) parts.push(`− ${r.in_print} at press`);
  const short = leftThisMonth(r) + r.need_next + r.safety + r.loss_extra - r.on_hand - r.in_print;
  const rounded = r.print_now > short ? ` (${short}, rounded up to batches of ${r.print_batch})` : "";
  return `${parts.join(" ")} = ${r.print_now}${rounded}`;
}
