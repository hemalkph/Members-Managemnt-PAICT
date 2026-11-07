import "server-only";

import { createSign } from "node:crypto";
import { effectivePageAccess, type getActionContext } from "@/lib/auth";
import {
  DRIVE_FILE_ID,
  isSourceFolder,
  isVideoRole,
  monthFolderKey,
  sortMonthFolders,
  VIDEO_SOURCES,
  type DriveMonth,
  type VideoSource,
} from "@/lib/drive-videos";
import { todayISO } from "@/lib/month";

type Ctx = NonNullable<Awaited<ReturnType<typeof getActionContext>>>;

/** Video editors (anyone holding a video role), admins and reviewers can browse the folder. */
export async function canUseDriveVideos(ctx: Ctx): Promise<boolean> {
  if (ctx.profile.is_admin || (await effectivePageAccess(ctx.profile, "review")) !== "none") return true;
  const { data } = await ctx.supabase.from("member_roles").select("roles(name)").eq("user_id", ctx.profile.id);
  return (data ?? []).some((r) => isVideoRole(r.roles?.name));
}

/** This calendar month's folder when it exists, otherwise the newest. */
export function defaultMonthId(months: DriveMonth[]): string | null {
  const now = todayISO().slice(0, 7);
  return (months.find((m) => monthFolderKey(m.name) === now) ?? months[0])?.id ?? null;
}

/*
 * Reads the team's "Social Media Videos" folder with a Google service account.
 * The folder is shared with the account as Viewer, so it can list files but
 * never change them. Plain HTTPS calls, no Google library.
 *
 * Env: GOOGLE_SERVICE_ACCOUNT_KEY (the key's JSON) and GOOGLE_DRIVE_VIDEOS_FOLDER_ID.
 */

const DRIVE = "https://www.googleapis.com/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";

export class DriveError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const NOT_SET_UP = "Google Drive isn't connected yet. Ask a main admin to finish the Drive set-up.";
const NOT_SHARED = "The app can't see the Drive folder. Share “Social Media Videos” with the app's robot account.";

function config() {
  const root = process.env.GOOGLE_DRIVE_VIDEOS_FOLDER_ID?.trim();
  let key: { client_email?: string; private_key?: string } | null = null;
  try {
    key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? "null");
  } catch {
    key = null;
  }
  if (!root || !DRIVE_FILE_ID.test(root) || !key?.client_email || !key.private_key) return null;
  return { root, email: key.client_email, privateKey: key.private_key };
}

let cachedToken: { value: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const cfg = config();
  if (!cfg) throw new DriveError(NOT_SET_UP);

  const now = Math.floor(Date.now() / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({
    iss: cfg.email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  let signature: string;
  try {
    signature = createSign("RSA-SHA256").update(unsigned).sign(cfg.privateKey, "base64url");
  } catch {
    throw new DriveError(NOT_SET_UP);
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new DriveError(NOT_SET_UP);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function driveGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${DRIVE}${path}?${new URLSearchParams({ supportsAllDrives: "true", ...params })}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` }, cache: "no-store" });
  if (res.status === 404 || res.status === 403) throw new DriveError(NOT_SHARED);
  if (!res.ok) throw new DriveError("Google Drive didn't answer. Please try again in a minute.");
  return (await res.json()) as T;
}

type FileRow = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
  size?: string;
  createdTime?: string;
  videoMediaMetadata?: { durationMillis?: string };
  owners?: { displayName?: string }[];
  lastModifyingUser?: { displayName?: string };
  thumbnailLink?: string;
};

async function listFiles(q: string, fields: string): Promise<FileRow[]> {
  const files: FileRow[] = [];
  let pageToken: string | undefined;
  do {
    const page = await driveGet<{ files: FileRow[]; nextPageToken?: string }>("/files", {
      q,
      fields: `nextPageToken, files(${fields})`,
      pageSize: "1000",
      orderBy: "name",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    files.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

const VIDEO_FIELDS = "id, name, mimeType, parents, size, createdTime, videoMediaMetadata(durationMillis), owners(displayName), lastModifyingUser(displayName)";

// Ids in queries come from Drive itself or the env, and are checked against this pattern first.
const quoted = (id: string) => {
  if (!DRIVE_FILE_ID.test(id)) throw new DriveError("Unknown folder.");
  return `'${id}'`;
};

/** The month folders inside the root folder, newest first. */
export async function listMonthFolders(): Promise<DriveMonth[]> {
  const cfg = config();
  if (!cfg) throw new DriveError(NOT_SET_UP);
  const rows = await listFiles(`${quoted(cfg.root)} in parents and mimeType = '${FOLDER}' and trashed = false`, "id, name");
  return sortMonthFolders(rows.map((r) => ({ id: r.id, name: r.name })));
}

/** The Edited / External edits folder of every month: folder id → where it is. */
async function sourceFolders(months: DriveMonth[]) {
  const found = new Map<string, { source: VideoSource; monthId: string; monthName: string }>();
  if (months.length === 0) return found;
  const byId = new Map(months.map((m) => [m.id, m]));
  const parents = months.map((m) => `${quoted(m.id)} in parents`).join(" or ");
  const rows = await listFiles(`(${parents}) and mimeType = '${FOLDER}' and trashed = false`, "id, name, parents");
  for (const row of rows) {
    const source = (Object.keys(VIDEO_SOURCES) as VideoSource[]).find((s) => isSourceFolder(row.name, s));
    const month = byId.get(row.parents?.find((p) => byId.has(p)) ?? "");
    if (source && month) found.set(row.id, { source, monthId: month.id, monthName: month.name });
  }
  return found;
}

export type VerifiedVideo = {
  id: string;
  name: string;
  source: VideoSource;
  monthName: string;
  mimeType: string;
  sizeBytes: number | null;
  durationMs: number | null;
  createdAt: string | null;
  uploadedBy: string | null;
};

function toVideo(row: FileRow, place: { source: VideoSource; monthName: string }): VerifiedVideo {
  const size = Number(row.size);
  const duration = Number(row.videoMediaMetadata?.durationMillis);
  return {
    id: row.id,
    name: row.name.slice(0, 300),
    source: place.source,
    monthName: place.monthName,
    mimeType: row.mimeType,
    sizeBytes: Number.isFinite(size) ? size : null,
    durationMs: Number.isFinite(duration) ? Math.round(duration) : null,
    createdAt: row.createdTime ?? null,
    uploadedBy: row.owners?.[0]?.displayName ?? row.lastModifyingUser?.displayName ?? null,
  };
}

/** The videos in one month's Edited or External edits folder. */
export async function listVideos(months: DriveMonth[], monthId: string, source: VideoSource): Promise<VerifiedVideo[]> {
  const month = months.find((m) => m.id === monthId);
  if (!month) throw new DriveError("Unknown month folder.");
  const folders = [...(await sourceFolders([month])).entries()].filter(([, f]) => f.source === source);
  if (folders.length === 0) return [];
  const parents = folders.map(([id]) => `${quoted(id)} in parents`).join(" or ");
  const rows = await listFiles(`(${parents}) and mimeType contains 'video/' and trashed = false`, VIDEO_FIELDS);
  return rows.map((row) => toVideo(row, { source, monthName: month.name }));
}

/**
 * Checks videos a member picked: each must be a video, not in the bin, and sit
 * in an Edited / External edits folder of a month. Details come from Drive, not the browser.
 */
export async function verifyVideos(ids: string[]): Promise<VerifiedVideo[]> {
  if (ids.length === 0) return [];
  const places = await sourceFolders(await listMonthFolders());
  const rows = await Promise.all(
    ids.map((id) =>
      driveGet<FileRow>(`/files/${encodeURIComponent(id)}`, { fields: `${VIDEO_FIELDS}, trashed` }).catch(() => null),
    ),
  );
  return rows.map((row, i) => {
    const place = row && places.get(row.parents?.find((p) => places.has(p)) ?? "");
    if (!row || row.trashed || !row.mimeType.startsWith("video/") || !place) {
      throw new DriveError(`One of the videos isn't in an Edited or External edits folder any more (${ids[i]}). Pick it again.`);
    }
    return toVideo(row, place);
  });
}

/** A video's thumbnail image, or null when Drive has none yet. */
export async function fetchThumbnail(id: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  const row = await driveGet<FileRow>(`/files/${encodeURIComponent(id)}`, { fields: "thumbnailLink, mimeType" });
  if (!row.thumbnailLink || !row.mimeType.startsWith("video/")) return null;
  const res = await fetch(row.thumbnailLink, { headers: { authorization: `Bearer ${await accessToken()}` }, cache: "no-store" });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) return null;
  return { body: await res.arrayBuffer(), type };
}
