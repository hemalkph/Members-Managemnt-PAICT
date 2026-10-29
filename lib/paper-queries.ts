import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { todayISO } from "@/lib/month";
import type { PaperView, StageView } from "@/lib/papers";

type Client = SupabaseClient<Database>;

const PAPER_SELECT =
  "id, title, kind, medium, part, exam_day, lms_link, physical_link, handed_over_at, files_cleared_at, files_cleared_count, exam_id, notes, status, created_at, completed_at, exam:exams(name, batch:batches(name)), paper_stages(id, stage, position, owner_id, start_date, due_date, link, status, completed_at, owner:profiles!paper_stages_owner_id_fkey(full_name, email))";

type Row = {
  id: string;
  title: string;
  kind: "paper" | "tute";
  medium: "si" | "both";
  part: "mcq" | "essay" | "full";
  exam_day: string | null;
  lms_link: string | null;
  physical_link: string | null;
  handed_over_at: string | null;
  files_cleared_at: string | null;
  files_cleared_count: number | null;
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
    start_date: string | null;
    due_date: string | null;
    link: string | null;
    status: StageView["status"];
    completed_at: string | null;
    owner: { full_name: string; email: string } | null;
  }[];
};

function toView(row: Row, today: string, names?: Map<string, string>): PaperView {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    medium: row.medium,
    part: row.part,
    examDay: row.exam_day,
    lmsLink: row.lms_link,
    physicalLink: row.physical_link,
    handedOverAt: row.handed_over_at,
    filesClearedAt: row.files_cleared_at,
    filesClearedCount: row.files_cleared_count,
    examId: row.exam_id,
    examLabel: row.exam ? `${row.exam.batch?.name ? `${row.exam.batch.name} – ` : ""}${row.exam.name}` : null,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    linkCount: row.paper_stages.filter((s) => s.link).length,
    stages: [...row.paper_stages]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        stage: s.stage,
        position: s.position,
        ownerId: s.owner_id,
        ownerName: s.owner ? s.owner.full_name || s.owner.email : ((s.owner_id && names?.get(s.owner_id)) ?? null),
        startDate: s.start_date,
        dueDate: s.due_date,
        link: s.link,
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
  /** Names for people the viewer can't read directly (from the team directory). */
  names?: Map<string, string>,
): Promise<PaperView[]> {
  let query = supabase.from("papers").select(PAPER_SELECT).order("created_at", { ascending: false }).limit(300);
  if (filters.examId) query = query.eq("exam_id", filters.examId);
  if (filters.status) query = query.eq("status", filters.status);
  const { data } = await query;
  const today = todayISO();
  return ((data ?? []) as unknown as Row[]).map((r) => toView(r, today, names));
}

export async function getPaper(supabase: Client, id: string, names?: Map<string, string>): Promise<PaperView | null> {
  const { data } = await supabase.from("papers").select(PAPER_SELECT).eq("id", id).maybeSingle();
  return data ? toView(data as unknown as Row, todayISO(), names) : null;
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
