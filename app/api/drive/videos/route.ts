import { NextResponse, type NextRequest } from "next/server";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { canUseDriveVideos, defaultMonthId, DriveError, listMonthFolders, listVideos } from "@/lib/work/drive";
import type { DriveVideosResponse, VideoSource } from "@/lib/work/drive-videos";
import { uuid } from "@/lib/core/validation";

const json = (body: DriveVideosResponse, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * The videos in one month's Edited / External edits folder, for the video picker.
 * ?month=<folder id> (default: this month's folder) &source=edited|external
 * &submission=<id of the entry being edited, so its own videos aren't "already logged">
 */
export async function GET(request: NextRequest) {
  const ctx = await getActionContext();
  if (!ctx) return json({ ok: false, error: NOT_ALLOWED }, 401);
  if (!(await canUseDriveVideos(ctx))) return json({ ok: false, error: NOT_ALLOWED }, 403);

  const params = request.nextUrl.searchParams;
  const source: VideoSource = params.get("source") === "external" ? "external" : "edited";
  const submission = uuid.safeParse(params.get("submission")).success ? params.get("submission") : null;

  try {
    const months = await listMonthFolders();
    const monthId = months.find((m) => m.id === params.get("month"))?.id ?? defaultMonthId(months);
    const videos = monthId ? await listVideos(months, monthId, source) : [];

    const { data: claims } = videos.length
      ? await ctx.supabase.rpc("claimed_drive_videos", { p_ids: videos.map((v) => v.id), p_submission: submission })
      : { data: [] };
    const claimed = new Map((claims ?? []).map((c) => [c.drive_file_id, c.mine]));

    return json({
      ok: true,
      months,
      monthId,
      source,
      videos: videos
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .map((v) => ({
          id: v.id,
          name: v.name,
          sizeBytes: v.sizeBytes,
          durationMs: v.durationMs,
          createdAt: v.createdAt,
          uploadedBy: v.uploadedBy,
          claimed: claimed.has(v.id),
          claimedByMe: claimed.get(v.id) === true,
        })),
    });
  } catch (error) {
    if (error instanceof DriveError) return json({ ok: false, error: error.message }, 502);
    throw error;
  }
}
