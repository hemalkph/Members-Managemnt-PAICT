import { NextResponse } from "next/server";
import { hookAuthorized, sendPushToUser } from "@/lib/push";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

/**
 * Called by the database (pg_net) when a notification is created: sends it to
 * the person's phones. Protected by the shared hook secret.
 */
export async function POST(request: Request) {
  if (!hookAuthorized(request)) return new NextResponse("Not allowed", { status: 401 });
  if (!hasServiceRoleKey()) return new NextResponse("Service role key missing", { status: 503 });

  const body = (await request.json().catch(() => null)) as { notification_id?: number | string } | null;
  const id = Number(body?.notification_id);
  if (!Number.isSafeInteger(id) || id <= 0) return new NextResponse("Bad request", { status: 400 });

  const admin = createAdminClient();
  const { data: n } = await admin
    .from("notifications")
    .select("id, user_id, kind, title, body, link, read_at")
    .eq("id", id)
    .maybeSingle();
  if (!n || n.read_at) return NextResponse.json({ sent: 0 });

  const sent = await sendPushToUser(admin, n.user_id, {
    title: n.title,
    body: n.body,
    url: n.link ?? "/notifications",
    // Grouped messages (e.g. "3 submissions waiting") replace the older alert.
    tag: n.kind === "review.pending" ? "review.pending" : `n-${n.id}`,
  });
  return NextResponse.json({ sent });
}
