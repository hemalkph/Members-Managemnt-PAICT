import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { PAPERS_BUCKET } from "@/lib/papers";

type Client = SupabaseClient<Database>;

const DAY = 86_400_000;

export type CleanupResult = { papers: number; files: number; bytes: number; days: number };

/**
 * Deletes the draft files of papers that were handed over (or finished /
 * cancelled) more than `paper_file_days` days ago. Needs the service-role
 * client: it removes storage objects and stamps the paper.
 */
export async function cleanupPaperFiles(admin: Client, now = Date.now()): Promise<CleanupResult> {
  const { data: settings } = await admin.from("app_settings").select("paper_file_days").limit(1).maybeSingle();
  const days = settings?.paper_file_days ?? 14;
  const cutoff = now - days * DAY;

  const { data: papers } = await admin
    .from("papers")
    .select("id, status, handed_over_at, completed_at, updated_at, paper_files(id, storage_path, size_bytes)")
    .is("files_cleared_at", null)
    .limit(200);

  const result: CleanupResult = { papers: 0, files: 0, bytes: 0, days };
  for (const p of papers ?? []) {
    const files = (p.paper_files ?? []) as { id: string; storage_path: string; size_bytes: number }[];
    if (files.length === 0) continue;
    // From when the files are no longer needed.
    const since =
      p.handed_over_at ?? (p.status === "done" ? p.completed_at : p.status === "cancelled" ? p.updated_at : null);
    if (!since || Date.parse(since) > cutoff) continue;

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
      .update({ files_cleared_at: new Date(now).toISOString(), files_cleared_count: files.length })
      .eq("id", p.id);

    result.papers += 1;
    result.files += files.length;
    result.bytes += files.reduce((sum, f) => sum + (f.size_bytes || 0), 0);
  }
  return result;
}

export type StorageUse = { bucket: string; files: number; bytes: number };

/** Supabase free plan storage. */
export const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;
