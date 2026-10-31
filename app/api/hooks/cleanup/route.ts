import { NextResponse } from "next/server";
import { cleanupDispatchImports } from "@/lib/dispatch/cleanup";
import { cleanupPaperFiles } from "@/lib/paper-cleanup";
import { hookAuthorized } from "@/lib/push";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

/**
 * Called daily by the database (pg_cron + pg_net): deletes paper files past
 * their keep time and old tute-dispatch import files.
 */
export async function POST(request: Request) {
  if (!hookAuthorized(request)) return new NextResponse("Not allowed", { status: 401 });
  if (!hasServiceRoleKey()) return new NextResponse("Service role key missing", { status: 503 });
  try {
    const admin = createAdminClient();
    const papers = await cleanupPaperFiles(admin);
    const dispatch = await cleanupDispatchImports(admin);
    return NextResponse.json({ ...papers, dispatch });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
