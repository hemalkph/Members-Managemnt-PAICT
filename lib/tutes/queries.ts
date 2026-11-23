import type { SupabaseClient } from "@supabase/supabase-js";
import { monthKeyToDate } from "@/lib/core/month";
import type { Database, TuteMoveKind, TutePrintJobStatus, TuteStockRow } from "@/lib/supabase/database.types";

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
  by: string;
  createdAt: string;
};

export async function getTuteBatches(supabase: Client) {
  const { data } = await supabase.from("batches").select("id, name, is_active, sort_order").order("sort_order").order("name");
  return (data ?? []).map((b) => ({ id: b.id, name: b.name, isActive: b.is_active }));
}

/** Everything the Tute stock page shows for one batch and month. */
export async function getTuteWorkspace(supabase: Client, batchId: string, month: string) {
  const [stock, jobs, printers, moves, directory] = await Promise.all([
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
  ]);
  if (stock.error) throw new Error(stock.error.message);

  const nameById = new Map((directory.data ?? []).map((p) => [p.id, p.name]));

  return {
    stock: (stock.data ?? []) as TuteStockRow[],
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
        by: (m.created_by && nameById.get(m.created_by)) || "—",
        createdAt: m.created_at,
      }),
    ),
  };
}
