// The latest sync run of a Citypak list, and its latest COMPLETE run (a partial
// or failed run never counts as "synced"). Server only.
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type RunStream = "bulk_uploads" | "orders";
export type LastRun = Pick<
  Database["public"]["Tables"]["citypak_sync_runs"]["Row"],
  "outcome" | "error_class" | "created_at" | "rejected_count" | "truncated"
>;

export async function loadRunStatus(
  supabase: SupabaseClient<Database>,
  account: string,
  stream: RunStream,
): Promise<{ last: LastRun | null; lastComplete: string | null }> {
  const runs = () => supabase.from("citypak_sync_runs").select("outcome, error_class, created_at, rejected_count, truncated").eq("account", account).eq("stream", stream);
  const [{ data: last }, { data: complete }] = await Promise.all([
    runs().order("created_at", { ascending: false }).limit(1),
    runs().eq("outcome", "ok").order("created_at", { ascending: false }).limit(1),
  ]);
  return { last: last?.[0] ?? null, lastComplete: complete?.[0]?.created_at ?? null };
}
