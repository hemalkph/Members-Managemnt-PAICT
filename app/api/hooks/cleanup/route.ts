import { NextResponse } from "next/server";
import { cleanupPaperFiles } from "@/lib/papers/cleanup";
import { cleanupConcessionFiles } from "@/lib/students/cleanup";
import { hookAuthorized } from "@/lib/notifications/push";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

/**
 * Called daily by the database (pg_cron + pg_net): deletes paper files past
 * their keep time, and GN certificates 12 months after a concession ended.
 */
export async function POST(request: Request) {
  if (!hookAuthorized(request)) return new NextResponse("Not allowed", { status: 401 });
  if (!hasServiceRoleKey()) return new NextResponse("Service role key missing", { status: 503 });
  try {
    const admin = createAdminClient();
    const papers = await cleanupPaperFiles(admin);
    const certificates = await cleanupConcessionFiles(admin);
    return NextResponse.json({ ...papers, certificates: certificates.files });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
