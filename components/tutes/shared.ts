import type { TuteMoveKind, TuteStockRow, TuteStockStatus } from "@/lib/supabase/database.types";
import type { TutePrinter, TutePrintJob } from "@/lib/tutes/queries";
import { MOVE_KIND_LABEL } from "@/lib/tutes/helpers";

export type PaperOption = { id: string; title: string; medium: string };
export type ClassOption = { id: string; name: string; batch: string };
export type TuteTab = "stock" | "plan" | "jobs" | "history";
export type StockFilter = "all" | "out" | "low" | "action" | "not_counted" | "scheduled" | "printing" | "ok";

export type DialogState =
  | { kind: "count" | "issue" | "damaged"; row: TuteStockRow }
  | { kind: "tute"; row: TuteStockRow | null }
  | { kind: "job"; row: TuteStockRow | null; suggestedQty?: number }
  | { kind: "edit_job"; job: TutePrintJob }
  | { kind: "receive"; jobs: TutePrintJob[]; initialJobId: string }
  | { kind: "printer"; printer: TutePrinter | null };

export const STATUS: Record<
  TuteStockStatus,
  { label: string; variant: "destructive" | "warning" | "success" | "outline" | "secondary" }
> = {
  not_counted: { label: "Not counted", variant: "secondary" },
  out: { label: "Out", variant: "destructive" },
  low: { label: "Low", variant: "warning" },
  ok: { label: "OK", variant: "success" },
  not_scheduled: { label: "Not scheduled", variant: "outline" },
};

export const STATUS_ORDER: TuteStockStatus[] = ["not_counted", "out", "low", "ok", "not_scheduled"];

export const KIND = MOVE_KIND_LABEL;

export const KIND_BADGE: Record<TuteMoveKind, "success" | "secondary" | "destructive" | "warning" | "outline"> = {
  opening_stock: "outline",
  print_in: "success",
  class_issue: "secondary",
  post_out: "secondary",
  return_in: "success",
  damaged: "destructive",
  count_fix: "warning",
};

export const JOB_STATUS = {
  planned: { label: "Planned", variant: "outline" },
  printing: { label: "Printing", variant: "warning" },
  received: { label: "Received", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
} as const;
