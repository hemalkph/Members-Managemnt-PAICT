import type { SupabaseClient } from "@supabase/supabase-js";
import { monthKeyToDate } from "@/lib/core/month";
import { signedTuteCoverUrls } from "@/lib/core/storage";
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
  tuteId: string;
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

/** Everything the Tute stock page shows for one month (one shelf for every batch). */
export async function getTuteWorkspace(supabase: Client, month: string) {
  const [stock, jobs, printers, moves, directory, report, held, pace, papers, classes, covers] = await Promise.all([
    supabase.rpc("tute_stock_summary", { p_month: monthKeyToDate(month) }),
    supabase
      .from("tute_print_jobs")
      .select("*, class_tutes!inner(name)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("tute_printers").select("*").order("is_active", { ascending: false }).order("name"),
    supabase
      .from("tute_stock_moves")
      .select("*, class_tutes!inner(name), fee_classes(name)")
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.rpc("team_directory"),
    supabase.rpc("tute_forecast_report", { p_batch: null }),
    supabase.from("tute_stock_reservations").select("tute_id, qty").eq("status", "active"),
    supabase.rpc("tute_pace_status"),
    supabase.rpc("tute_paper_options"),
    supabase.from("fee_classes").select("id, name, batches(name)").eq("is_active", true).order("name"),
    supabase.from("class_tutes").select("id, cover_path").not("cover_path", "is", null),
  ]);
  if (stock.error) throw new Error(stock.error.message);

  const signedCovers = await signedTuteCoverUrls(
    supabase,
    (covers.data ?? []).map((c) => c.cover_path),
  );
  const coverUrls: Record<string, string> = {};
  for (const c of covers.data ?? []) {
    if (c.cover_path) {
      const url = signedCovers.get(c.cover_path);
      if (url) coverUrls[c.id] = url;
    }
  }

  const nameById = new Map((directory.data ?? []).map((p) => [p.id, p.name]));
  // Copies held for Speed Post rounds that aren't handed over yet.
  const reserved: Record<string, number> = {};
  for (const r of held.data ?? []) reserved[r.tute_id] = (reserved[r.tute_id] ?? 0) + r.qty;

  return {
    stock: (stock.data ?? []) as TuteStockRow[],
    reserved,
    coverUrls,
    /** Paper Library tutes a catalog tute can be linked to (for "PDF ready"). */
    papers: papers.data ?? [],
    /** Active classes in every batch (for optional one-step scheduling when creating a tute). */
    classes: (classes.data ?? []).map((c) => ({ id: c.id, name: c.name, batch: c.batches?.name ?? "" })),
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
        tuteId: m.tute_id,
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
