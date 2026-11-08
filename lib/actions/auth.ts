"use server";

import { ownPasswordAllowed } from "@/lib/auth";
import { type ActionResult } from "@/lib/core/action-result";
import { createClient } from "@/lib/supabase/server";
import {
  fieldErrorsOf,
  firstError,
  loginSchema,
  resetPasswordSchema,
  type LoginInput,
  type ResetPasswordInput,
} from "@/lib/core/validation";

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

export async function resetPasswordAction(input: ResetPasswordInput): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error), fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your link has expired. Ask a main admin to send a new one." };
  if (!(await ownPasswordAllowed())) {
    return { ok: false, error: "Ask a main admin (the Owner or Manager) to reset your password." };
  }

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
