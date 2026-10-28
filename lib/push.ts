import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import type { Database } from "@/lib/database.types";
import { getSiteUrl } from "@/lib/env";

type Client = SupabaseClient<Database>;

export type PushPayload = { title: string; body?: string | null; url?: string | null; tag?: string };

/** Phone notifications need these three server settings. */
export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** Contact for push services: must be an https: or mailto: address. */
function vapidSubject(): string {
  const given = process.env.VAPID_SUBJECT?.trim();
  if (given && /^(https:|mailto:)/.test(given)) return given;
  const site = getSiteUrl();
  return site.startsWith("https:") ? site : "mailto:admin@paict.lk";
}

let ready = false;
function setup() {
  if (ready) return;
  webpush.setVapidDetails(vapidSubject(), process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  ready = true;
}

/**
 * Sends one notification to every phone/browser the person turned alerts on
 * for. Subscriptions the browser has dropped (404/410) are removed.
 * Pass the service-role client (the hook) or the person's own client (test).
 */
export async function sendPushToUser(client: Client, userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;
  setup();
  const { data: subs } = await client
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs?.length) return 0;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    url: payload.url || "/notifications",
    tag: payload.tag,
  });
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 60 * 60 * 24,
          urgency: "high",
        });
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.id);
      }
    }),
  );
  if (gone.length) await client.from("push_subscriptions").delete().in("id", gone);
  if (sent) {
    await client.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("user_id", userId);
  }
  return sent;
}

/** Shared secret the database sends with hook calls. */
export function hookAuthorized(request: Request): boolean {
  const secret = process.env.APP_HOOK_SECRET;
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (given.length !== secret.length) return false;
  // Constant-time compare.
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
