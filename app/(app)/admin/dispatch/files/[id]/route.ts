import { NextResponse, type NextRequest } from "next/server";
import { getActionContext } from "@/lib/auth";
import { uuid } from "@/lib/validation";

/**
 * Opens a private courier file (waybills, Citypak sheets, template). Needs the
 * dispatch page and the plan or courier permission (checked by the database
 * through RLS and dispatch_log_download, which also records the download),
 * then redirects to a signed URL valid for 60 seconds.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/admin/dispatch/files/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return new NextResponse("Not found", { status: 404 });

  const ctx = await getActionContext({ page: "dispatch", edit: true });
  if (!ctx) return NextResponse.redirect(new URL("/login", request.url));

  const { data: file } = await ctx.supabase
    .from("carrier_files")
    .select("id, storage_path, file_name")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });

  const { error: logError } = await ctx.supabase.rpc("dispatch_log_download", { p_file: file.id });
  if (logError) return new NextResponse("Not allowed", { status: 403 });

  const { data, error } = await ctx.supabase.storage
    .from("dispatch")
    .createSignedUrl(file.storage_path, 60, { download: file.file_name });
  if (error || !data) return new NextResponse("File not available", { status: 404 });

  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
