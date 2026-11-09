import { NextResponse } from "next/server";
import { cleanupPaperFiles } from "@/lib/papers/cleanup";
import { hookAuthorized } from "@/lib/notifications/push";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

/**
 * Called daily by the database (pg_cron + pg_net): deletes paper files past
 * their keep time.
 */
export async function POST(request: Request) {
  if (!hookAuthorized(request)) return new NextResponse("Not allowed", { status: 401 });
  if (!hasServiceRoleKey()) return new NextResponse("Service role key missing", { status: 503 });
  try {
    const admin = createAdminClient();
    return NextResponse.json(await cleanupPaperFiles(admin));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
