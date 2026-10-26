import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export const ATTACHMENTS_BUCKET = "attachments";
export const AVATARS_BUCKET = "avatars";
const SIGNED_URL_SECONDS = 60 * 60; // 1 hour

type Client = SupabaseClient<Database>;

/** Signed URL for one avatar (private bucket). Null if missing or not allowed. */
export async function signedAvatarUrl(supabase: Client, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(AVATARS_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  return data?.signedUrl ?? null;
}

/** Signed URLs for many avatars at once, keyed by path. */
export async function signedAvatarUrls(supabase: Client, paths: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await supabase.storage.from(AVATARS_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map.set(item.path, item.signedUrl);
  }
  return map;
}
