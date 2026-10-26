import { NextResponse, type NextRequest } from "next/server";
import { getActionContext } from "@/lib/auth";
import { PAPERS_BUCKET } from "@/lib/papers";
import { uuid } from "@/lib/validation";

/**
 * Opens a paper file. RLS decides who may read the row (admins and the
 * paper's stage owners); the browser is redirected to a 60-second signed URL.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/papers/files/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return new NextResponse("Not found", { status: 404 });

  const ctx = await getActionContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", request.url));

  const { data: file } = await ctx.supabase
    .from("paper_files")
    .select("storage_path, file_name, version")
    .eq("id", id)
    .maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const { data, error } = await ctx.supabase.storage
    .from(PAPERS_BUCKET)
    .createSignedUrl(file.storage_path, 60, download ? { download: `v${file.version}-${file.file_name}` } : undefined);
  if (error || !data) return new NextResponse("File not available", { status: 404 });

  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
