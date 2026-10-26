"use server";

import { type ActionResult } from "@/lib/action-result";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  fieldErrorsOf,
  firstError,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
} from "@/lib/validation";

export async function signInAction(input: LoginInput): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    return { ok: false, error: "Wrong email or password." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return { ok: false, error: "Your account is deactivated. Please contact an admin." };
  }

  // Two-step login is on: ask for the authenticator code next.
  if ((data.user.factors ?? []).some((f) => f.factor_type === "totp" && f.status === "verified")) {
    return { ok: true, data: { redirectTo: "/login/two-step" } };
  }

  return { ok: true, data: { redirectTo: profile.is_admin ? "/admin" : "/dashboard" } };
}

export async function forgotPasswordAction(input: ForgotPasswordInput): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getSiteUrl()}/auth/confirm?next=/reset-password`,
  });

  // Same answer whether or not the email exists, so accounts can't be guessed.
  return { ok: true, message: "If that email has an account, a reset link is on its way." };
}

export async function resetPasswordAction(input: ResetPasswordInput): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your reset link has expired. Please request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      ok: false,
      error: error.message.toLowerCase().includes("different")
        ? "Choose a password different from your old one."
        : "Could not update the password. Please try again.",
    };
  }
  return { ok: true, message: "Password updated." };
}
