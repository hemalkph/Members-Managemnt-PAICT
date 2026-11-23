import type { SupabaseClient } from "@supabase/supabase-js";
import { monthKeyToDate } from "@/lib/core/month";
import type {
  Database,
  TuteForecastMethod,
  TuteMoveKind,
  TutePrintJobStatus,
  TuteStockRow,
} from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type TutePrinter = { id: string; name: string; phone: string; notes: string; usualDays: number; isActive: boolean };

export type TutePrintJob = {
  id: string;
  tuteId: string;
  tuteName: string;
  printerId: string | null;
  qty: number;
  receivedQty: number;
  status: TutePrintJobStatus;
  cost: number | null;
  dueDate: string | null;
  note: string;
  createdAt: string;
  startedAt: string | null;
  receivedAt: string | null;
};

export type TuteMove = {
  id: string;
  tuteName: string;
  qty: number;
  kind: TuteMoveKind;
  className: string | null;
  month: string | null;
  note: string;
  /** Why the number looked odd ("" when fine). */
  flag: string;
  by: string;
  createdAt: string;
};

export type TuteForecastCheck = {
  classId: string;
  className: string;
  month: string;
  forecast: number;
  actual: number;
  method: TuteForecastMethod;
};

export async function getTuteBatches(supabase: Client) {
  const { data } = await supabase.from("batches").select("id, name, is_active, sort_order").order("sort_order").order("name");
  return (data ?? []).map((b) => ({ id: b.id, name: b.name, isActive: b.is_active }));
}

/** Everything the Tute stock page shows for one batch and month. */
export async function getTuteWorkspace(supabase: Client, batchId: string, month: string) {
  const [stock, jobs, printers, moves, directory, report, held, pace] = await Promise.all([
    supabase.rpc("tute_stock_summary", { p_batch: batchId, p_month: monthKeyToDate(month) }),
    supabase
      .from("tute_print_jobs")
      .select("*, class_tutes!inner(name, batch_id)")
      .eq("class_tutes.batch_id", batchId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("tute_printers").select("*").order("is_active", { ascending: false }).order("name"),
    supabase
      .from("tute_stock_moves")
      .select("*, class_tutes!inner(name, batch_id), fee_classes(name)")
      .eq("class_tutes.batch_id", batchId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.rpc("team_directory"),
    supabase.rpc("tute_forecast_report", { p_batch: batchId }),
    supabase.from("tute_stock_reservations").select("tute_id, qty").eq("status", "active"),
    supabase.rpc("tute_pace_status", { p_batch: batchId }),
  ]);
  if (stock.error) throw new Error(stock.error.message);

  const nameById = new Map((directory.data ?? []).map((p) => [p.id, p.name]));
  // Copies held for Speed Post rounds that aren't handed over yet.
  const reserved: Record<string, number> = {};
  for (const r of held.data ?? []) reserved[r.tute_id] = (reserved[r.tute_id] ?? 0) + r.qty;

  return {
    stock: (stock.data ?? []) as TuteStockRow[],
    reserved,
    /** Past class-months the mid-month forecast has learned from, and how many it needs. */
    pace: pace.data?.[0] ?? { samples: 0, needed: 4 },
    report: (report.data ?? []).map(
      (r): TuteForecastCheck => ({
        classId: r.class_id,
        className: r.class_name,
        month: r.month.slice(0, 7),
        forecast: r.forecast,
        actual: r.actual,
        method: r.method,
      }),
    ),
    printers: (printers.data ?? []).map(
      (p): TutePrinter => ({
        id: p.id,
        name: p.name,
        phone: p.phone,
        notes: p.notes,
        usualDays: p.usual_days,
        isActive: p.is_active,
      }),
    ),
    jobs: (jobs.data ?? []).map(
      (j): TutePrintJob => ({
        id: j.id,
        tuteId: j.tute_id,
        tuteName: j.class_tutes.name,
        printerId: j.printer_id,
        qty: j.qty,
        receivedQty: j.received_qty,
        status: j.status,
        cost: j.cost,
        dueDate: j.due_date,
        note: j.note,
        createdAt: j.created_at,
        startedAt: j.started_at,
        receivedAt: j.received_at,
      }),
    ),
    moves: (moves.data ?? []).map(
      (m): TuteMove => ({
        id: m.id,
        tuteName: m.class_tutes.name,
        qty: m.qty,
        kind: m.kind,
        className: m.fee_classes?.name ?? null,
        month: m.month,
        note: m.note,
        flag: m.flag,
        by: (m.created_by && nameById.get(m.created_by)) || "—",
        createdAt: m.created_at,
      }),
    ),
  };
}
