import { NextResponse, type NextRequest } from "next/server";
import { getActionContext } from "@/lib/auth";
import { canUseDriveVideos, DriveError, fetchThumbnail } from "@/lib/drive";
import { DRIVE_FILE_ID } from "@/lib/drive-videos";

/**
 * A Drive video's thumbnail, fetched with the app's Drive account so viewers
 * don't need to be signed in to Google. Only files in the shared folder are visible to it.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/drive/thumbnail/[id]">) {
  const { id } = await params;
  if (!DRIVE_FILE_ID.test(id)) return new NextResponse("Not found", { status: 404 });

  const ctx = await getActionContext();
  if (!ctx || !(await canUseDriveVideos(ctx))) return new NextResponse("Not allowed", { status: 403 });

  try {
    const image = await fetchThumbnail(id);
    if (!image) return new NextResponse("No thumbnail", { status: 404 });
    return new NextResponse(image.body, {
      headers: { "Content-Type": image.type, "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    if (error instanceof DriveError) return new NextResponse("Not available", { status: 404 });
    throw error;
  }
}
