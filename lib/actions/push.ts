"use server";

import { friendlyDbError, type ActionResult } from "@/lib/core/action-result";
import { getActionContext, NOT_ALLOWED } from "@/lib/auth";
import { pushConfigured, sendPushToUser } from "@/lib/notifications/push";
import { pushSubscriptionSchema } from "@/lib/core/validation";

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

  // Saved with this login session; if someone else used this phone before, it moves to you.
  const { error } = await ctx.supabase.rpc("push_subscription_save", {
    p_endpoint: v.endpoint,
    p_p256dh: v.p256dh,
    p_auth: v.auth,
    p_device: v.device || "",
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true, message: "Phone notifications are on" };
}

/**
 * Links this phone to the current login session again (after signing in anew).
 * Returns false when the phone's alerts aren't yours, so the page shows them as off.
 */
export async function refreshPushSubscriptionAction(input: { endpoint: string }): Promise<ActionResult<{ mine: boolean }>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (typeof input.endpoint !== "string" || !input.endpoint.startsWith("https://") || input.endpoint.length > 1000) {
    return { ok: true, message: "", data: { mine: false } };
  }
  const { data } = await ctx.supabase.rpc("push_subscription_refresh", { p_endpoint: input.endpoint });
  return { ok: true, message: "", data: { mine: data === true } };
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
