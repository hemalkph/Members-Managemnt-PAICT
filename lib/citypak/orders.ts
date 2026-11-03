// Citypak orders ("orders/created"): only the fields seen in Citypak's responses –
// id, tracking_number, reference, created_at – validated and turned into our
// shape. Other fields in the response are ignored (their meaning is not
// verified). Pure – unit tested with fixtures.
import { z } from "zod";
import { citypakTime, externalIdSchema, pageSchema, type Page } from "./bulk-uploads";
import { CitypakError } from "./http";

export type CitypakOrder = {
  externalId: number;
  /** Citypak tracking number, upper case without spaces, or null when Citypak gave none. */
  trackingNo: string | null;
  /** Citypak's reference for the order (our parcel reference when we sent one), or "". */
  reference: string;
  createdAt: string | null;
};
export type OrderPage = Page<CitypakOrder>;

/** Upper case, spaces removed – the same shape the database keeps (and parcels use). */
const identifier = (re: RegExp) =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .pipe(z.union([z.literal(""), z.string().regex(re)]))
    .nullish();

const rowSchema = z.object({
  id: externalIdSchema,
  tracking_number: identifier(/^[A-Z0-9]{4,30}$/),
  reference: identifier(/^[A-Z0-9-]{1,60}$/),
  created_at: z.string().nullish(),
});

/** One page of orders. A wrong envelope throws; a bad record is only counted. */
export function parseOrderPage(json: unknown): OrderPage {
  const page = pageSchema.safeParse(json);
  if (!page.success) throw new CitypakError("invalid_response");
  const d = page.data.data;
  const rows: CitypakOrder[] = [];
  let rejected = 0;
  for (const raw of d.data) {
    const r = rowSchema.safeParse(raw);
    if (!r.success) {
      rejected++;
      continue;
    }
    rows.push({
      externalId: r.data.id,
      trackingNo: r.data.tracking_number || null,
      reference: r.data.reference ?? "",
      createdAt: citypakTime(r.data.created_at),
    });
  }
  return { page: d.current_page, lastPage: d.last_page, perPage: d.per_page, total: d.total, rows, rejected };
}

/** The rows citypak_sync_orders expects. */
export function orderDbRows(rows: CitypakOrder[]) {
  return rows.map((r) => ({
    external_id: r.externalId,
    tracking_no: r.trackingNo,
    reference: r.reference,
    external_created_at: r.createdAt,
  }));
}

export type MatchStatus = "matched" | "reference_only" | "conflict" | "unmatched";
export type ConflictReason =
  | "duplicate_tracking"
  | "duplicate_reference"
  | "different_parcels"
  | "reference_differs"
  | "tracking_differs";
export const MATCH_STATUSES: MatchStatus[] = ["matched", "reference_only", "conflict", "unmatched"];
