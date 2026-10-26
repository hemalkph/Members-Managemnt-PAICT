import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { todayISO } from "@/lib/month";
import type { PaperView, StageView } from "@/lib/papers";

type Client = SupabaseClient<Database>;

const PAPER_SELECT =
  "id, title, kind, exam_id, notes, status, created_at, completed_at, exam:exams(name, batch:batches(name)), paper_stages(id, stage, position, owner_id, due_date, status, completed_at, owner:profiles!paper_stages_owner_id_fkey(full_name, email)), paper_files(count)";

type Row = {
  id: string;
  title: string;
  kind: "paper" | "tute";
  exam_id: string | null;
  notes: string | null;
  status: "in_progress" | "done" | "cancelled";
  created_at: string;
  completed_at: string | null;
  exam: { name: string; batch: { name: string } | null } | null;
  paper_stages: {
    id: string;
    stage: StageView["stage"];
    position: number;
    owner_id: string | null;
    due_date: string | null;
    status: StageView["status"];
    completed_at: string | null;
    owner: { full_name: string; email: string } | null;
  }[];
  paper_files: { count: number }[];
};

function toView(row: Row, today: string): PaperView {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    examId: row.exam_id,
    examLabel: row.exam ? `${row.exam.batch?.name ? `${row.exam.batch.name} – ` : ""}${row.exam.name}` : null,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    fileCount: row.paper_files?.[0]?.count ?? 0,
    stages: [...row.paper_stages]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        stage: s.stage,
        position: s.position,
        ownerId: s.owner_id,
        ownerName: s.owner ? s.owner.full_name || s.owner.email : null,
        dueDate: s.due_date,
        status: s.status,
        completedAt: s.completed_at,
        overdue: s.status === "in_progress" && Boolean(s.due_date && s.due_date < today),
      })),
  };
}

/** Papers the viewer can see (admins: all; members: papers where they own a stage). */
export async function getPapers(
  supabase: Client,
  filters: { examId?: string | null; status?: "in_progress" | "done" | "cancelled" | null } = {},
): Promise<PaperView[]> {
  let query = supabase.from("papers").select(PAPER_SELECT).order("created_at", { ascending: false }).limit(300);
  if (filters.examId) query = query.eq("exam_id", filters.examId);
  if (filters.status) query = query.eq("status", filters.status);
  const { data } = await query;
  const today = todayISO();
  return ((data ?? []) as unknown as Row[]).map((r) => toView(r, today));
}

export async function getPaper(supabase: Client, id: string): Promise<PaperView | null> {
  const { data } = await supabase.from("papers").select(PAPER_SELECT).eq("id", id).maybeSingle();
  return data ? toView(data as unknown as Row, todayISO()) : null;
}

export type PaperFileView = {
  id: string;
  stage: StageView["stage"];
  version: number;
  fileName: string;
  sizeBytes: number;
  note: string | null;
  uploadedBy: string | null;
  uploadedById: string | null;
  createdAt: string;
};

export async function getPaperFiles(supabase: Client, paperId: string): Promise<PaperFileView[]> {
  const { data } = await supabase
    .from("paper_files")
    .select("id, stage, version, file_name, size_bytes, note, uploaded_by, created_at, uploader:profiles!paper_files_uploaded_by_fkey(full_name, email)")
    .eq("paper_id", paperId)
    .order("stage")
    .order("version", { ascending: false });
  return (data ?? []).map((f) => {
    const uploader = f.uploader as { full_name: string; email: string } | null;
    return {
      id: f.id,
      stage: f.stage,
      version: f.version,
      fileName: f.file_name,
      sizeBytes: f.size_bytes,
      note: f.note,
      uploadedBy: uploader ? uploader.full_name || uploader.email : null,
      uploadedById: f.uploaded_by,
      createdAt: f.created_at,
    };
  });
}
