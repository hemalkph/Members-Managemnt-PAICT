import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationView } from "@/components/notifications/notification-item";
import type { Database } from "@/lib/database.types";

/** Latest notifications and the unread count for the bell. */
export async function getBellNotifications(
  supabase: SupabaseClient<Database>,
  userId: string,
  limit = 15,
): Promise<{ items: NotificationView[]; unread: number }> {
  const [{ data }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, kind, title, body, link, created_at, read_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null),
  ]);
  return {
    items: (data ?? []).map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      link: n.link,
      createdAt: n.created_at,
      read: n.read_at !== null,
    })),
    unread: count ?? 0,
  };
}
