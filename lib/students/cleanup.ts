import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { CONCESSION_BUCKET } from "@/lib/core/validation";

const KEEP_DAYS = 365;

/**
 * Deletes the GN certificate files of students whose concession ended more
 * than 12 months ago. The rows go too (each removal is logged by a database
 * trigger as "System"). Needs the service-role client.
 */
export async function cleanupConcessionFiles(admin: SupabaseClient<Database>, now = Date.now()): Promise<{ files: number }> {
  const cutoff = new Date(now - KEEP_DAYS * 86_400_000).toISOString();
  const { data: ended } = await admin
    .from("concession_students")
    .select("id")
    .eq("status", "ended")
    .lt("status_changed_at", cutoff)
    .limit(500);
  const ids = (ended ?? []).map((s) => s.id);
  if (ids.length === 0) return { files: 0 };

  const { data: files } = await admin.from("concession_documents").select("id, storage_path").in("student_id", ids);
  if (!files?.length) return { files: 0 };
  for (let i = 0; i < files.length; i += 100) {
    const chunk = files.slice(i, i + 100);
    const { error } = await admin.storage.from(CONCESSION_BUCKET).remove(chunk.map((f) => f.storage_path));
    if (error) throw new Error(`Could not delete certificate files: ${error.message}`);
    await admin.from("concession_documents").delete().in("id", chunk.map((f) => f.id));
  }
  return { files: files.length };
}
