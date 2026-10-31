// Matching a processed Citypak sheet (or waybill PDF text) against a round's
// frozen manifest. Pure functions: the server runs them and the database
// re-checks everything when tracking numbers are applied.

import type { Sheet } from "./import";
import { normalisePhone } from "./phone";

const TRACKING = /^[A-Z0-9]{4,30}$/;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type TrackingColumns = {
  reference: number;
  tracking: number;
  name?: number;
  phone?: number;
  city?: number;
  cod?: number;
};

/** Citypak's processed-sheet column names (exact, as in the verified sample). */
export function detectTrackingColumns(header: string[]): TrackingColumns | null {
  const names = header.map(norm);
  const at = (name: string) => {
    const i = names.indexOf(name);
    return i >= 0 ? i : undefined;
  };
  const reference = at("your reference");
  const tracking = at("citypak tracking");
  if (reference === undefined || tracking === undefined) return null;
  return {
    reference,
    tracking,
    name: at("receiver s address name"),
    phone: at("receiver s contact number 1"),
    city: at("receiver s address line 4 city"),
    cod: at("collection amount"),
  };
}

export type ManifestParcel = {
  id: string;
  reference: string;
  trackingNo: string | null;
  voided: boolean;
  name: string;
  phone1: string | null;
  city: string;
  cod: number;
};

export type TrackingStatus = "new" | "same" | "conflict" | "used" | "unknown" | "duplicate" | "missing" | "invalid" | "voided";

export type TrackingRow = {
  line: number;
  reference: string;
  trackingNo: string;
  status: TrackingStatus;
  message: string;
  /** Recipient or COD differences between the sheet and our manifest (warnings only). */
  differences: string[];
};

export type TrackingResult = {
  rows: TrackingRow[];
  counts: Record<TrackingStatus, number>;
  /** Manifest parcels that still have no tracking number and are not in this file. */
  notInFile: string[];
  /** Rows the database would apply. */
  apply: { reference: string; tracking_no: string }[];
};

const MESSAGE: Record<TrackingStatus, string> = {
  new: "Tracking number will be added",
  same: "Already has this tracking number",
  conflict: "Already has a different tracking number",
  used: "This tracking number belongs to another parcel",
  unknown: "Reference is not in this round",
  duplicate: "Appears more than once in the file",
  missing: "No tracking number in the file",
  invalid: "Tracking number looks wrong",
  voided: "Parcel was voided",
};

/**
 * @param usedElsewhere tracking numbers already held by parcels outside this round
 */
export function reconcileTracking(
  sheet: Sheet,
  cols: TrackingColumns,
  manifest: ManifestParcel[],
  usedElsewhere: Set<string>,
): TrackingResult {
  const byRef = new Map(manifest.map((p) => [p.reference, p]));
  const byTracking = new Map(manifest.filter((p) => p.trackingNo).map((p) => [p.trackingNo!, p]));
  const refCount = new Map<string, number>();
  const trkCount = new Map<string, number>();
  const raw = sheet.rows
    .map((row, i) => ({
      line: i + 2,
      row,
      reference: (row[cols.reference] ?? "").trim().toUpperCase(),
      trackingNo: (row[cols.tracking] ?? "").trim().toUpperCase(),
    }))
    .filter((r) => r.reference !== "" || r.trackingNo !== "");
  for (const r of raw) {
    refCount.set(r.reference, (refCount.get(r.reference) ?? 0) + 1);
    if (r.trackingNo) trkCount.set(r.trackingNo, (trkCount.get(r.trackingNo) ?? 0) + 1);
  }

  const rows: TrackingRow[] = raw.map((r) => {
    const parcel = byRef.get(r.reference);
    const differences: string[] = [];
    let status: TrackingStatus;
    if ((refCount.get(r.reference) ?? 0) > 1 || (r.trackingNo && (trkCount.get(r.trackingNo) ?? 0) > 1)) status = "duplicate";
    else if (!parcel) status = "unknown";
    else if (parcel.voided) status = "voided";
    else if (!r.trackingNo) status = "missing";
    else if (!TRACKING.test(r.trackingNo)) status = "invalid";
    else if (parcel.trackingNo === r.trackingNo) status = "same";
    else if (parcel.trackingNo) status = "conflict";
    else if (usedElsewhere.has(r.trackingNo) || (byTracking.get(r.trackingNo) && byTracking.get(r.trackingNo)!.id !== parcel.id)) {
      status = "used";
    } else status = "new";

    if (parcel) {
      const cell = (i?: number) => (i === undefined ? undefined : (r.row[i] ?? "").trim());
      const name = cell(cols.name);
      if (name !== undefined && name !== "" && norm(name) !== norm(parcel.name)) differences.push(`Name: “${name}” vs “${parcel.name}”`);
      const phone = cell(cols.phone);
      if (phone !== undefined && phone !== "") {
        const p = normalisePhone(phone).value;
        if (p !== parcel.phone1) differences.push(`Phone: ${phone} vs ${parcel.phone1 ?? "none"}`);
      }
      const city = cell(cols.city);
      if (city !== undefined && city !== "" && norm(city) !== norm(parcel.city)) differences.push(`City: ${city} vs ${parcel.city}`);
      const cod = cell(cols.cod);
      if (cod !== undefined && cod !== "" && Number(cod.replace(/[^0-9.]/g, "")) !== parcel.cod) {
        differences.push(`COD: ${cod} vs ${parcel.cod}`);
      }
    }
    return { line: r.line, reference: r.reference, trackingNo: r.trackingNo, status, message: MESSAGE[status], differences };
  });

  const counts = Object.fromEntries(Object.keys(MESSAGE).map((k) => [k, 0])) as Record<TrackingStatus, number>;
  for (const r of rows) counts[r.status] += 1;
  const inFile = new Set(rows.map((r) => r.reference));
  return {
    rows,
    counts,
    notInFile: manifest.filter((p) => !p.voided && !p.trackingNo && !inFile.has(p.reference)).map((p) => p.reference),
    apply: rows.filter((r) => r.status === "new").map((r) => ({ reference: r.reference, tracking_no: r.trackingNo })),
  };
}

/** Problems that stop tracking numbers being applied (nothing is applied until they are fixed). */
export function blockingTracking(result: TrackingResult): number {
  return result.counts.conflict + result.counts.used + result.counts.unknown + result.counts.duplicate + result.counts.invalid;
}

// ---------------------------------------------------------------- waybill PDF text

export type WaybillPair = { trackingNo: string; reference: string | null };

/**
 * Pair each tracking number with the next reference in the label text.
 * Citypak labels print the tracking number, then later "REFERENCE" and our
 * reference, so in reading order every D-number is followed by its reference.
 */
export function pairsFromText(text: string, prefixes: string[]): WaybillPair[] {
  const refPattern = prefixes.length > 0 ? prefixes.map((p) => p.replace(/[^A-Z0-9]/g, "")).filter(Boolean).join("|") : "";
  const re = new RegExp(`\\b(D\\d{8})\\b${refPattern ? `|\\b((?:${refPattern})[0-9A-Z]{1,20})\\b` : ""}`, "g");
  const pairs: WaybillPair[] = [];
  for (const m of text.toUpperCase().matchAll(re)) {
    if (m[1]) pairs.push({ trackingNo: m[1], reference: null });
    else if (m[2] && pairs.length > 0 && pairs[pairs.length - 1].reference === null) pairs[pairs.length - 1].reference = m[2];
  }
  return pairs;
}

export type WaybillCheck = {
  labels: number;
  matched: number;
  /** Labels whose tracking number and reference don't belong together in our records. */
  mismatched: WaybillPair[];
  /** Labels for parcels we don't know. */
  unknown: WaybillPair[];
  /** Registered parcels in this round with no label in the PDF. */
  missingLabels: string[];
};

export function checkWaybills(pairs: WaybillPair[], manifest: ManifestParcel[]): WaybillCheck {
  const byTracking = new Map(manifest.filter((p) => p.trackingNo).map((p) => [p.trackingNo!, p]));
  const byRef = new Map(manifest.map((p) => [p.reference, p]));
  let matched = 0;
  const mismatched: WaybillPair[] = [];
  const unknown: WaybillPair[] = [];
  const seen = new Set<string>();
  for (const pair of pairs) {
    const p = byTracking.get(pair.trackingNo);
    if (p) {
      seen.add(p.reference);
      if (pair.reference === p.reference) matched += 1;
      else mismatched.push(pair);
    } else if (pair.reference && byRef.get(pair.reference)) {
      mismatched.push(pair); // our reference, but a tracking number we don't have for it
      seen.add(pair.reference);
    } else unknown.push(pair);
  }
  return {
    labels: pairs.length,
    matched,
    mismatched,
    unknown,
    missingLabels: manifest.filter((p) => p.trackingNo && !p.voided && !seen.has(p.reference)).map((p) => p.reference),
  };
}
