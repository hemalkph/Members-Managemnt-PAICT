"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult } from "@/lib/action-result";
import { getActionContext, getAuthSession, NOT_ALLOWED } from "@/lib/auth";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { confirmTwoStepSchema, firstError, otpCodeSchema, uuid, type OtpCodeInput } from "@/lib/validation";

const WRONG_CODE = "That code didn't work. Check that the time on your phone is correct and try the newest code.";

function codeError(message: string | undefined): string {
  if (message && /rate|too many/i.test(message)) return "Too many tries. Wait a few minutes and try again.";
  return WRONG_CODE;
}

/** Supabase returns the QR code as a raw SVG data URL; encode it so characters like "#" can't break it. */
function safeQrDataUrl(qr: string): string {
  const match = /^data:image\/svg\+xml;(?:utf-8|charset=utf-8),([\s\S]*)$/.exec(qr);
  if (!match || match[1].startsWith("%3C")) return qr;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(match[1])}`;
}

/** Login step 2: check the authenticator code and upgrade the session. */
export async function verifyLoginCodeAction(input: OtpCodeInput): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = otpCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const session = await getAuthSession();
  if (!session) return { ok: false, error: "Your login has expired. Please log in again." };

  const factor = (session.user.factors ?? []).find((f) => f.factor_type === "totp" && f.status === "verified");
  if (!factor) return { ok: true, data: { redirectTo: "/" } };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data.code });
  if (error) return { ok: false, error: codeError(error.message) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_active")
    .eq("id", session.user.id)
    .maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { ok: false, error: "Your account is deactivated. Please contact an admin." };
  }
  return { ok: true, data: { redirectTo: profile.is_admin ? "/admin" : "/dashboard" } };
}

/** Start setting up an authenticator app: returns the QR code and secret. */
export async function startTwoStepSetupAction(): Promise<
  ActionResult<{ factorId: string; qrCode: string; secret: string }>
> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const session = await getAuthSession();
  if (session?.hasTwoStep) return { ok: false, error: "Two-step login is already on." };

  // Remove half-finished set-ups so the new one can use the same name.
  const { data: factors } = await ctx.supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.status !== "verified") await ctx.supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await ctx.supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator app",
    issuer: "Team Work Tracker",
  });
  if (error || !data) {
    return {
      ok: false,
      error: /disabled|not enabled/i.test(error?.message ?? "")
        ? "Authenticator apps are turned off in Supabase (Authentication → Multi-Factor). Turn on TOTP and try again."
        : "Could not start the set-up. Please try again.",
    };
  }
  return { ok: true, data: { factorId: data.id, qrCode: safeQrDataUrl(data.totp.qr_code), secret: data.totp.secret } };
}

/** Finish the set-up with the first code from the app. */
export async function confirmTwoStepSetupAction(input: { factorId: string; code: string }): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = confirmTwoStepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { error } = await ctx.supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) return { ok: false, error: codeError(error.message) };

  await ctx.supabase.rpc("log_event", { p_action: "two_step.enabled" });
  revalidatePath("/", "layout");
  return { ok: true, message: "Two-step login is on" };
}

/** Turn off two-step login for yourself (not allowed for main admins). */
export async function disableTwoStepAction(): Promise<ActionResult> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (ctx.profile.is_main_admin) {
    return { ok: false, error: "Main admins must keep two-step login on." };
  }

  const { data: factors } = await ctx.supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    const { error } = await ctx.supabase.auth.mfa.unenroll({ factorId: f.id });
    if (error) return { ok: false, error: "Could not turn off two-step login. Log out, log in again and retry." };
  }
  // Drop the two-step level from the current session.
  await ctx.supabase.auth.refreshSession();
  await ctx.supabase.rpc("log_event", { p_action: "two_step.disabled" });
  revalidatePath("/", "layout");
  return { ok: true, message: "Two-step login is off" };
}

/** Main admins: remove someone's authenticator (e.g. they lost their phone). */
export async function resetTwoStepAction(input: { userId: string }): Promise<ActionResult> {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const parsed = uuid.safeParse(input.userId);
  if (!parsed.success) return { ok: false, error: "Member not found." };
  const userId = parsed.data;
  if (userId === ctx.profile.id) return { ok: false, error: "You can't reset your own two-step login." };
  if (!hasServiceRoleKey()) {
    return { ok: false, error: "Resetting two-step login needs SUPABASE_SERVICE_ROLE_KEY on the server." };
  }

  const { data: target } = await ctx.supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  if (!target) return { ok: false, error: "Member not found." };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) return { ok: false, error: "Could not read their two-step login. Please try again." };
  for (const f of data?.factors ?? []) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
    if (deleteError) return { ok: false, error: "Could not reset their two-step login. Please try again." };
  }

  await ctx.supabase.rpc("log_event", { p_action: "two_step.reset", p_target: userId });
  revalidatePath("/security");
  return {
    ok: true,
    message: `Two-step login reset for ${target.full_name || target.email}. They can set it up again after logging in.`,
  };
}
