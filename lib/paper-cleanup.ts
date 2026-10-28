import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { FINAL_STAGES, PAPERS_BUCKET } from "@/lib/papers";

type Client = SupabaseClient<Database>;

const DAY = 86_400_000;

export type CleanupResult = { papers: number; files: number; bytes: number; days: number };

/**
 * Keeps each paper's final outputs (the latest hand-over PDF and marking
 * schemes) and deletes everything else – drafts, marked PDFs and older
 * versions – once the paper was handed over (or finished / cancelled) more
 * than `paper_file_days` days ago. A file is only deleted when it is itself
 * older than that, so a late upload still gets its keep time. Needs the
 * service-role client: it removes storage objects and stamps the paper.
 */
export async function cleanupPaperFiles(admin: Client, now = Date.now()): Promise<CleanupResult> {
  const { data: settings } = await admin.from("app_settings").select("paper_file_days").limit(1).maybeSingle();
  const days = settings?.paper_file_days ?? 14;
  const cutoff = now - days * DAY;

  const { data: papers } = await admin
    .from("papers")
    .select(
      "id, status, handed_over_at, completed_at, updated_at, files_cleared_count, paper_files(id, stage, version, storage_path, size_bytes, created_at)",
    )
    .neq("status", "in_progress")
    .limit(1000);
  // Papers still in progress but already handed over (the marking scheme comes later).
  const { data: handedOver } = await admin
    .from("papers")
    .select(
      "id, status, handed_over_at, completed_at, updated_at, files_cleared_count, paper_files(id, stage, version, storage_path, size_bytes, created_at)",
    )
    .eq("status", "in_progress")
    .not("handed_over_at", "is", null)
    .limit(1000);

  const result: CleanupResult = { papers: 0, files: 0, bytes: 0, days };
  for (const p of [...(papers ?? []), ...(handedOver ?? [])]) {
    const all = (p.paper_files ?? []) as CleanupFile[];
    if (all.length === 0) continue;
    // From when the drafts are no longer needed.
    const since =
      p.handed_over_at ?? (p.status === "done" ? p.completed_at : p.status === "cancelled" ? p.updated_at : null);
    if (!since || Date.parse(since) > cutoff) continue;

    const files = removableFiles(all).filter((f) => Date.parse(f.created_at) <= cutoff);
    if (files.length === 0) continue;

    for (let i = 0; i < files.length; i += 100) {
      const chunk = files.slice(i, i + 100);
      const { error } = await admin.storage.from(PAPERS_BUCKET).remove(chunk.map((f) => f.storage_path));
      if (error) throw new Error(`Could not delete files: ${error.message}`);
    }
    await admin
      .from("paper_files")
      .delete()
      .in(
        "id",
        files.map((f) => f.id),
      );
    await admin
      .from("papers")
      .update({
        files_cleared_at: new Date(now).toISOString(),
        files_cleared_count: (p.files_cleared_count ?? 0) + files.length,
      })
      .eq("id", p.id);

    result.papers += 1;
    result.files += files.length;
    result.bytes += files.reduce((sum, f) => sum + (f.size_bytes || 0), 0);
  }
  return result;
}

type CleanupFile = {
  id: string;
  stage: string;
  version: number;
  storage_path: string;
  size_bytes: number;
  created_at: string;
};

/** Everything except the latest version of each final stage (hand-over PDF, marking schemes). */
export function removableFiles<T extends { stage: string; version: number }>(files: T[]): T[] {
  const latest = new Map<string, number>();
  for (const f of files) latest.set(f.stage, Math.max(latest.get(f.stage) ?? 0, f.version));
  return files.filter((f) => !(FINAL_STAGES as string[]).includes(f.stage) || f.version !== latest.get(f.stage));
}

export type StorageUse = { bucket: string; files: number; bytes: number };

/** Supabase free plan storage. */
export const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;
