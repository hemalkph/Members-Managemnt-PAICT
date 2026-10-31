import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const DAY = 86_400_000;
const BUCKET = "dispatch";

/**
 * Deletes uploaded student-import files older than the retention period
 * (including uploads that were never turned into an import) and stamps the
 * import records. Runs from the nightly cleanup hook with the service-role client.
 */
export async function cleanupDispatchImports(admin: SupabaseClient<Database>, now = Date.now()) {
  const { data: settings } = await admin.from("dispatch_settings").select("import_file_retention_days").limit(1).maybeSingle();
  const days = settings?.import_file_retention_days ?? 30;
  const cutoff = now - days * DAY;

  const old: string[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const { data: files, error } = await admin.storage
      .from(BUCKET)
      .list("imports", { limit: 1000, offset, sortBy: { column: "created_at", order: "asc" } });
    if (error || !files || files.length === 0) break;
    for (const f of files) {
      if (f.created_at && Date.parse(f.created_at) < cutoff) old.push(`imports/${f.name}`);
    }
    if (files.length < 1000) break;
  }

  for (let i = 0; i < old.length; i += 100) {
    const chunk = old.slice(i, i + 100);
    const { error } = await admin.storage.from(BUCKET).remove(chunk);
    if (error) throw new Error(`Could not delete import files: ${error.message}`);
    await admin
      .from("student_imports")
      .update({ file_deleted_at: new Date(now).toISOString() })
      .in("storage_path", chunk)
      .is("file_deleted_at", null);
  }
  return { importFilesDeleted: old.length, importRetentionDays: days };
}
