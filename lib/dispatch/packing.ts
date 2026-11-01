// Shapes shared by the packing station (browser) and its server actions.

export type ScanMode = "pack" | "verify";

export type ParcelCard = {
  id: string;
  round_id: string;
  reference: string;
  tracking_no: string | null;
  student_no: string;
  cod: number;
  registration_state: string;
  pack_state: "planned" | "packed" | "verified";
  delivery_state: string;
  on_hold: boolean;
  row_version: number;
  assigned_name: string | null;
  packed_name: string | null;
  packed_at: string | null;
  verified_name: string | null;
  verified_at: string | null;
  items: { id: string; code: string; title: string; qty: number }[];
  exceptions: { kind: string; note: string }[];
};

export type LookupResult = {
  result: "ready" | "unknown" | "wrong_round" | "duplicate" | "not_ready" | "not_assigned" | "blocked";
  message?: string;
  code?: string;
  card?: ParcelCard;
};

export type ConfirmResult = {
  result: "ok" | "duplicate" | "not_ready" | "not_assigned" | "blocked" | "changed" | "items";
  message: string;
  reference?: string;
  replayed?: boolean;
};

/** One tute of the round: parcels and copies needed, and how many are packed. */
export type TuteCount = {
  id: string;
  code: string;
  title: string;
  extra: boolean;
  parcels: number;
  copies: number;
  packedParcels: number;
  packedCopies: number;
};

export type Progress = {
  total: number;
  registered: number;
  packed: number;
  verified: number;
  onHold: number;
  mine: number;
  tutes: TuteCount[];
};

export const PROBLEM_KINDS = [
  { key: "missing_item", label: "A tute is missing" },
  { key: "damaged", label: "Damaged" },
  { key: "wrong_address", label: "Wrong address" },
  { key: "label_problem", label: "Label problem" },
  { key: "cod_issue", label: "COD problem" },
  { key: "other", label: "Other" },
] as const;

/** Problem labels by kind, including "returned" (reported by delivery, not at the station). */
export const PROBLEM_LABEL: Record<string, string> = {
  ...Object.fromEntries(PROBLEM_KINDS.map((k) => [k.key, k.label])),
  returned: "Returned",
};
