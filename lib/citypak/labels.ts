// Labels for Citypak processing statuses and failed sync runs (English keys; shown through t()).
export const BULK_STATUS: Record<string, { label: string; variant: "success" | "destructive" | "outline" }> = {
  SUCCESS: { label: "Processed", variant: "success" },
  FAILED: { label: "Failed", variant: "destructive" },
};

export const RUN_OUTCOME: Record<"ok" | "partial" | "failed", { label: string; variant: "success" | "warning" | "destructive" }> = {
  ok: { label: "Complete", variant: "success" },
  partial: { label: "Incomplete", variant: "warning" },
  failed: { label: "Failed", variant: "destructive" },
};

/**
 * The Citypak tables aren't in the database: migrations 028 and 029 haven't been
 * applied there (PostgREST "table not found" / Postgres "undefined table").
 */
export function isMissingCitypakTables(err: { code?: string } | null | undefined): boolean {
  return err?.code === "PGRST205" || err?.code === "42P01";
}

export const RUN_ERROR: Record<string, string> = {
  unauthorised: "Citypak refused the credentials.",
  rate_limited: "Citypak asked us to slow down.",
  network: "Couldn't reach Citypak.",
  server: "Citypak had a problem.",
  invalid_response: "Citypak sent something we couldn't read.",
  save_failed: "The batches couldn't be saved.",
  internal: "Something went wrong.",
};

/** How a Citypak order relates to Tute dispatch parcels (worked out when read; informational only). */
export const ORDER_MATCH: Record<
  "matched" | "reference_only" | "conflict" | "unmatched",
  { label: string; variant: "success" | "warning" | "destructive" | "outline"; hint: string }
> = {
  matched: { label: "Matched", variant: "success", hint: "Its tracking number and reference point to the same dispatch parcel." },
  reference_only: {
    label: "Reference only",
    variant: "warning",
    hint: "Its reference matches a dispatch parcel that has no tracking number yet.",
  },
  conflict: { label: "Conflict", variant: "destructive", hint: "Its identifiers disagree with Tute dispatch. Check it by hand." },
  unmatched: { label: "Not matched", variant: "outline", hint: "No dispatch parcel has its tracking number or reference." },
};

export const CONFLICT_REASON: Record<string, string> = {
  duplicate_tracking: "Another Citypak order has the same tracking number.",
  duplicate_reference: "Another Citypak order has the same reference. It may be a reshipment – check both orders by hand.",
  different_parcels: "The tracking number and the reference belong to two different dispatch parcels.",
  reference_differs: "The tracking number belongs to a dispatch parcel with a different reference.",
  tracking_differs: "The reference belongs to a dispatch parcel with a different tracking number.",
};
