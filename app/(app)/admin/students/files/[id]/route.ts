import { NextResponse, type NextRequest } from "next/server";
import { getActionContext } from "@/lib/auth";
import { CONCESSION_BUCKET, uuid } from "@/lib/core/validation";

/**
 * Opens a GN certificate. Needs the Students page; the opening is written to
 * the activity log first (no log, no file), then the browser is redirected
 * to a 60-second signed URL.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/admin/students/files/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return new NextResponse("Not found", { status: 404 });

  const ctx = await getActionContext({ page: "students" });
  if (!ctx) return NextResponse.redirect(new URL("/login", request.url));

  const { data: file } = await ctx.supabase
    .from("concession_documents")
    .select("storage_path, file_name")
    .eq("id", id)
    .maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });

  const { error: logError } = await ctx.supabase.rpc("concession_document_opened", { p_doc: id });
  if (logError) return new NextResponse("Not allowed", { status: 403 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const { data, error } = await ctx.supabase.storage
    .from(CONCESSION_BUCKET)
    .createSignedUrl(file.storage_path, 60, download ? { download: file.file_name } : undefined);
  if (error || !data) return new NextResponse("File not available", { status: 404 });

  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
