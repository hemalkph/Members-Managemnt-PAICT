/** Shared by the video picker (browser) and the Drive code (server). */

export type VideoSource = "edited" | "external";

/** Sub-folder names inside each month folder, matched without case or extra spaces. */
export const VIDEO_SOURCES: Record<VideoSource, string> = { edited: "Edited", external: "External edits" };

export type DriveMonth = { id: string; name: string };

export type DriveVideo = {
  id: string;
  name: string;
  sizeBytes: number | null;
  durationMs: number | null;
  createdAt: string | null;
  uploadedBy: string | null;
  /** Logged in another work entry that wasn't rejected. */
  claimed: boolean;
  /** That entry is the viewer's own. */
  claimedByMe: boolean;
};

export type DriveVideosResponse =
  | { ok: true; months: DriveMonth[]; monthId: string | null; source: VideoSource; videos: DriveVideo[] }
  | { ok: false; error: string };

/** A picked video as the form keeps it. */
export type PickedVideo = { id: string; name: string };

// shortcut: video roles are found by name ("Video Editing", "Video Editor"…); add a role setting if a video role is ever named differently.
export function isVideoRole(name: string | null | undefined) {
  return /video/i.test(name ?? "");
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "2026 October" (or "October 2026", "2026 Oct") → "2026-10"; null for other names. */
export function monthFolderKey(name: string): string | null {
  const words = name.trim().toLowerCase().split(/\s+/);
  if (words.length !== 2) return null;
  const year = words.find((w) => /^\d{4}$/.test(w));
  const word = words.find((w) => w !== year);
  if (!year || !word || word.length < 3) return null;
  const index = MONTHS.findIndex((m) => m.startsWith(word));
  return index === -1 ? null : `${year}-${String(index + 1).padStart(2, "0")}`;
}

/** Month folders newest first; folders with other names go last, by name. */
export function sortMonthFolders(months: DriveMonth[]): DriveMonth[] {
  return [...months].sort((a, b) => {
    const ka = monthFolderKey(a.name);
    const kb = monthFolderKey(b.name);
    if (ka && kb) return kb.localeCompare(ka);
    if (ka || kb) return ka ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** True when a folder name is the one for this source ("edited " → Edited). */
export function isSourceFolder(name: string, source: VideoSource) {
  return name.trim().toLowerCase() === VIDEO_SOURCES[source].toLowerCase();
}

/** 95000 → "1:35", 3725000 → "1:02:05". */
export function formatDuration(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,100}$/;

export const driveViewUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
export const driveThumbnailUrl = (id: string) => `/api/drive/thumbnail/${id}`;
