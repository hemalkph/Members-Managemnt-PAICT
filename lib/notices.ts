import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoticeItem } from "@/components/notice-board";
import type { Database } from "@/lib/database.types";
import { todayISO } from "@/lib/month";

/** Current notices (not expired), pinned first, newest first. */
export async function getCurrentNotices(supabase: SupabaseClient<Database>, limit = 5): Promise<NoticeItem[]> {
  const { data } = await supabase
    .from("announcements")
    .select("id, title, body, pinned, created_at, expires_on, author:profiles!announcements_created_by_fkey(full_name)")
    .or(`expires_on.is.null,expires_on.gte.${todayISO()}`)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    pinned: n.pinned,
    created_at: n.created_at,
    author: n.author?.full_name ?? null,
  }));
}
