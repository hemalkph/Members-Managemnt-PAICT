import { NextResponse, type NextRequest } from "next/server";
import { getActionContext } from "@/lib/auth";
import { ATTACHMENTS_BUCKET } from "@/lib/storage";
import { uuid } from "@/lib/validation";

/**
 * Opens a private attachment. RLS decides who may read the row (owner or
 * admin); the browser is then redirected to a signed URL valid for 60 seconds.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/files/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return new NextResponse("Not found", { status: 404 });

  const ctx = await getActionContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", request.url));

  const { data: attachment } = await ctx.supabase
    .from("submission_attachments")
    .select("storage_path, file_name")
    .eq("id", id)
    .maybeSingle();
  if (!attachment) return new NextResponse("Not found", { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const { data, error } = await ctx.supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(attachment.storage_path, 60, download ? { download: attachment.file_name } : undefined);
  if (error || !data) return new NextResponse("File not available", { status: 404 });

  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
