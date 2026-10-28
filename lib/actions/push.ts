"use server";

import { friendlyDbError, type ActionResult } from "@/lib/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { pushConfigured, sendPushToUser } from "@/lib/push";
import { pushSubscriptionSchema } from "@/lib/validation";

/** Saves this phone/browser so notifications reach it. */
export async function savePushSubscriptionAction(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string;
}): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This browser can't receive notifications." };
  const v = parsed.data;

  // The same phone may have been saved before (maybe for someone else who used it).
  await ctx.supabase.from("push_subscriptions").delete().eq("endpoint", v.endpoint);
  const { error } = await ctx.supabase.from("push_subscriptions").insert({
    user_id: ctx.profile.id,
    endpoint: v.endpoint,
    p256dh: v.p256dh,
    auth: v.auth,
    device: v.device || null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true, message: "Phone notifications are on" };
}

/** Stops notifications to this phone/browser. */
export async function removePushSubscriptionAction(input: { endpoint: string }): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (typeof input.endpoint !== "string" || !input.endpoint.startsWith("https://")) {
    return { ok: false, error: "Nothing to turn off." };
  }
  await ctx.supabase.from("push_subscriptions").delete().eq("endpoint", input.endpoint).eq("user_id", ctx.profile.id);
  return { ok: true, message: "Phone notifications are off on this device" };
}

/** Sends a test alert to all of the person's devices. */
export async function sendTestPushAction(): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!pushConfigured()) return { ok: false, error: "Phone notifications aren't set up on the server yet." };
  const sent = await sendPushToUser(ctx.supabase, ctx.profile.id, {
    title: "Notifications are working 🎉",
    body: "You'll get alerts like “Your turn: Type set (English)” here.",
    url: "/notifications",
    tag: "test",
  });
  return sent > 0
    ? { ok: true, message: `Test sent to ${sent} device${sent === 1 ? "" : "s"}` }
    : { ok: false, error: "No device got it. Turn notifications off and on again on this phone." };
}
