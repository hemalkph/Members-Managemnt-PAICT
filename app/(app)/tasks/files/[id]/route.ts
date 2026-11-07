import { NextResponse, type NextRequest } from "next/server";
import { getActionContext } from "@/lib/auth";
import { TASKS_BUCKET, uuid } from "@/lib/core/validation";

/**
 * Opens a task file. RLS decides who may read the row (people who can see the
 * task); the browser is redirected to a 60-second signed URL. Opening a file
 * from the other side stops it showing as new.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/tasks/files/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return new NextResponse("Not found", { status: 404 });

  const ctx = await getActionContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", request.url));

  const { data: file } = await ctx.supabase
    .from("task_files")
    .select("storage_path, file_name, seen_at")
    .eq("id", id)
    .maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const { data, error } = await ctx.supabase.storage
    .from(TASKS_BUCKET)
    .createSignedUrl(file.storage_path, 60, download ? { download: file.file_name } : undefined);
  if (error || !data) return new NextResponse("File not available", { status: 404 });

  if (!file.seen_at) await ctx.supabase.rpc("task_file_seen", { p_file: id });

  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
