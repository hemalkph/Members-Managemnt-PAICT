import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/lib/database.types";
import { isProfileComplete } from "@/lib/profile-completion";
import { createClient } from "@/lib/supabase/server";

export type AuthSession = {
  user: User;
  /** True when the user has a verified authenticator app. */
  hasTwoStep: boolean;
  /** True when this session entered the authenticator code (aal2). */
  twoStepVerified: boolean;
};

/**
 * The signed-in user plus their two-step login state, or null. Cached per request.
 * getUser() verifies the session with Supabase Auth; getClaims() reads the
 * verified token's "aal" (assurance level).
 */
export const getAuthSession = cache(async (): Promise<AuthSession | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.auth.getClaims();
  const aal = data?.claims?.aal;
  const hasTwoStep = (user.factors ?? []).some((f) => f.factor_type === "totp" && f.status === "verified");
  return { user, hasTwoStep, twoStepVerified: aal === "aal2" };
});

/** The signed-in user's profile, or null. Cached per request. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const session = await getAuthSession();
  if (!session) return null;
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  return profile ?? null;
});

/** True when the user turned on two-step login but hasn't entered the code in this session. */
async function needsTwoStepCode(): Promise<boolean> {
  const session = await getAuthSession();
  return Boolean(session?.hasTwoStep && !session.twoStepVerified);
}

/**
 * For pages: redirect to login if signed out, to the code page if two-step
 * login is on but not done yet, and sign out if deactivated.
 */
export async function requireUser(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.is_active) redirect("/auth/signout?reason=inactive");
  if (await needsTwoStepCode()) redirect("/login/two-step");
  return profile;
}

/**
 * For member pages: members must complete their profile (name, phone,
 * WhatsApp, NIC) before using the app. Admins are not blocked.
 */
export async function requireCompleteProfile(): Promise<Profile> {
  const profile = await requireUser();
  if (!profile.is_admin && !isProfileComplete(profile)) redirect("/profile?complete=1");
  return profile;
}

/** For admin pages: members are sent back to their dashboard. */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireUser();
  if (!profile.is_admin) redirect("/dashboard");
  return profile;
}

/**
 * For main-admin pages (Analytics, Payments, Rates, Activity log). Other
 * admins go to the admin overview. Main admins must turn on two-step login
 * first (the database also requires it for main-admin powers).
 */
export async function requireMainAdmin(): Promise<Profile> {
  const profile = await requireAdmin();
  if (!profile.is_main_admin) redirect("/admin");
  const session = await getAuthSession();
  if (!session?.twoStepVerified) redirect("/security?required=1");
  return profile;
}

/** Whether a main admin can use main-admin pages right now (two-step done). */
export async function mainAdminUnlocked(profile: Profile): Promise<boolean> {
  if (!profile.is_main_admin) return false;
  const session = await getAuthSession();
  return Boolean(session?.twoStepVerified);
}

/**
 * For Server Actions and Route Handlers: never trust the client, re-check here.
 * Returns null instead of redirecting so the action can return an error.
 */
export async function getActionContext(options: { admin?: boolean; mainAdmin?: boolean } = {}) {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active) return null;
  if (await needsTwoStepCode()) return null;
  if ((options.admin || options.mainAdmin) && !profile.is_admin) return null;
  if (options.mainAdmin && !(await mainAdminUnlocked(profile))) return null;
  const supabase = await createClient();
  return { profile, supabase };
}

export const NOT_ALLOWED = "You are not signed in or not allowed to do this.";
