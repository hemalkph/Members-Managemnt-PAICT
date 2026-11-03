// Citypak bulk-upload batches: the observed `client_panel_api` list contract,
// validated and turned into our shape. Pure – unit tested with fixtures.
// A batch's `tracking_number` is the BATCH reference, not a parcel tracking number.
import { z } from "zod";
import { CitypakError } from "./http";

export type BulkUpload = {
  externalId: number;
  batchReference: string;
  fileName: string;
  /** Raw Citypak processing status, upper case (observed: SUCCESS, FAILED). */
  status: string;
  waybills: number;
  hasOriginalExcel: boolean;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
};

/** One page of a Citypak list (the same envelope for bulk uploads and orders). */
export type Page<T> = {
  page: number;
  lastPage: number;
  perPage: number;
  total: number;
  rows: T[];
  /** Records on this page that failed validation (left out, counted). */
  rejected: number;
};
export type BulkUploadPage = Page<BulkUpload>;

/** Citypak's paginated list envelope (Laravel style), shared by every list. */
export const pageSchema = z.object({
  data: z.object({
    current_page: z.number().int().min(1),
    last_page: z.number().int().min(0),
    per_page: z.number().int().min(1).max(1000),
    total: z.number().int().min(0),
    data: z.array(z.unknown()).max(1000),
  }),
});

/**
 * A Citypak record id: a positive safe integer, sent as a JSON number or a plain
 * digit string. No coercion – 0, "000", "007", " 12", "1e3", true or 1.5 are malformed.
 */
export const externalIdSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z
    .string()
    .regex(/^[1-9]\d{0,15}$/)
    .transform(Number)
    .pipe(z.number().max(Number.MAX_SAFE_INTEGER)),
]);

const text = (max: number) => z.string().trim().max(max).nullish();
const rowSchema = z.object({
  id: externalIdSchema,
  tracking_number: text(60),
  fileName: text(200),
  status: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z_]{1,30}$/),
  waybills: z.coerce.number().int().min(0).max(100_000).nullish(),
  excel_file_url: z.string().nullish(),
  started_datetime: z.string().nullish(),
  ended_datetime: z.string().nullish(),
  created_at: z.string().nullish(),
});

/**
 * Citypak times. "2026-10-31 10:22:11" (no zone) is taken as Sri Lanka time –
 * an assumption until Citypak documents it. Anything unreadable becomes null.
 */
export function citypakTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?$/.exec(v);
  const iso = local ? `${local[1]}T${local[2].length === 5 ? `${local[2]}:00` : local[2]}+05:30` : v;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(iso)) return null;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** One page of the bulk-upload list. A wrong envelope throws; a bad record is only counted. */
export function parseBulkUploadPage(json: unknown): BulkUploadPage {
  const page = pageSchema.safeParse(json);
  if (!page.success) throw new CitypakError("invalid_response");
  const d = page.data.data;
  const rows: BulkUpload[] = [];
  let rejected = 0;
  for (const raw of d.data) {
    const r = rowSchema.safeParse(raw);
    if (!r.success) {
      rejected++;
      continue;
    }
    const v = r.data;
    rows.push({
      externalId: v.id,
      batchReference: v.tracking_number ?? "",
      fileName: v.fileName ?? "",
      status: v.status,
      waybills: v.waybills ?? 0,
      hasOriginalExcel: Boolean(v.excel_file_url && v.excel_file_url.trim()),
      startedAt: citypakTime(v.started_datetime),
      endedAt: citypakTime(v.ended_datetime),
      createdAt: citypakTime(v.created_at),
    });
  }
  return { page: d.current_page, lastPage: d.last_page, perPage: d.per_page, total: d.total, rows, rejected };
}

/** The rows the database function expects. */
export function toDbRows(rows: BulkUpload[]) {
  return rows.map((r) => ({
    external_id: r.externalId,
    batch_reference: r.batchReference,
    file_name: r.fileName,
    status: r.status,
    waybills: r.waybills,
    has_original_excel: r.hasOriginalExcel,
    started_at: r.startedAt,
    ended_at: r.endedAt,
    external_created_at: r.createdAt,
  }));
}

/** Only print sizes whose Citypak parameter has been seen. A4 waits until its value is confirmed. */
export const PRINT_SIZES = ["4X6"] as const;
export type PrintSize = (typeof PRINT_SIZES)[number];
export function parsePrintSize(value: unknown): PrintSize {
  const v = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!(PRINT_SIZES as readonly string[]).includes(v)) throw new CitypakError("unsupported");
  return v as PrintSize;
}

/** Can waybills be printed for this batch? Failed uploads and empty batches have none. */
export function canPrint(b: { status: string; waybills: number }): boolean {
  return b.status === "SUCCESS" && b.waybills > 0;
}
