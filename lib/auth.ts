import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { Profile } from "@/lib/database.types";
import { hasAnyPage, pageAccess, type AccessLevel, type PageKey } from "@/lib/page-access";
import { isProfileComplete } from "@/lib/profile-completion";
import { createClient } from "@/lib/supabase/server";

export type AuthSession = {
  userId: string;
  email: string | null;
  /** True when the user has a verified authenticator app. */
  hasTwoStep: boolean;
  /** True when this session entered the authenticator code (aal2). */
  twoStepVerified: boolean;
};

/**
 * The login token's claims, or null. Cached per request.
 * getClaims() checks the token's signature on our server (the project signs with an
 * ES256 key), so page loads don't wait for Supabase Auth. The database trusts the
 * same token the same way. A session ended elsewhere stays valid until the token
 * expires, so Server Actions also ask Supabase Auth (see getActionContext).
 */
const getVerifiedClaims = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ? data.claims : null;
});

/** Whether the user has turned on an authenticator app, read fresh from the database. */
async function twoStepTurnedOn(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_two_step_on");
  if (!error) return Boolean(data);
  // The database function is missing (migration 39 not run yet): ask Supabase Auth instead.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (user?.factors ?? []).some((f) => f.factor_type === "totp" && f.status === "verified");
}

/** The signed-in user plus their two-step login state, or null. Cached per request. */
export const getAuthSession = cache(async (): Promise<AuthSession | null> => {
  const claims = await getVerifiedClaims();
  if (!claims) return null;
  const twoStepVerified = claims.aal === "aal2";
  return {
    userId: claims.sub,
    email: claims.email ?? null,
    // An aal2 session already proves a verified authenticator app.
    hasTwoStep: twoStepVerified || (await twoStepTurnedOn()),
    twoStepVerified,
  };
});

/** The signed-in user's profile, or null. Cached per request. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const claims = await getVerifiedClaims();
  if (!claims) return null;
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", claims.sub).maybeSingle();
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
  // Both start at once; the redirects below keep their order.
  const [profile, needsCode] = await Promise.all([getCurrentProfile(), needsTwoStepCode()]);
  // The proxy only lets signed-in visitors reach pages. No profile here means
  // the login cookie belongs to an account that is gone (deleted user, revoked
  // session): sign out to clear it. Redirecting to /login would loop, because
  // /login sends signed-in visitors back to "/".
  if (!profile) redirect("/auth/signout?reason=expired");
  if (!profile.is_active) redirect("/auth/signout?reason=inactive");
  if (needsCode) redirect("/login/two-step");
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

/** For the admin area: anyone who can open at least one admin page. */
export async function requireAnyPage(): Promise<Profile> {
  const profile = await requireUser();
  if (!hasAnyPage(profile)) redirect("/dashboard");
  return profile;
}

/**
 * For one admin page (see lib/page-access). Members who were given the page
 * must finish their profile and enter their two-step login code first (the
 * database checks the same). canEdit is false for read-only access.
 */
export async function requirePage(key: PageKey): Promise<{ profile: Profile; canEdit: boolean }> {
  const profile = await requireUser();
  const level = pageAccess(profile, key);
  if (level === "none") {
    redirect(key !== "overview" && pageAccess(profile, "overview") !== "none" ? "/admin" : "/dashboard");
  }
  if (!profile.is_admin) {
    if (!isProfileComplete(profile)) redirect("/profile?complete=1");
    const session = await getAuthSession();
    if (!session?.twoStepVerified) redirect("/security?required=1");
  }
  return { profile, canEdit: level === "edit" };
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
 * Access to an admin page for code outside that page (e.g. the paper page).
 * Members only get it after entering their two-step login code.
 */
export async function effectivePageAccess(profile: Profile, key: PageKey): Promise<AccessLevel> {
  const level = pageAccess(profile, key);
  if (level === "none" || profile.is_admin) return level;
  return (await getAuthSession())?.twoStepVerified ? level : "none";
}

/**
 * For Server Actions and Route Handlers: never trust the client, re-check here.
 * Returns null instead of redirecting so the action can return an error.
 */
export async function getActionContext(
  options: { admin?: boolean; mainAdmin?: boolean; page?: PageKey; edit?: boolean } = {},
) {
  const supabase = await createClient();
  // Writes and file downloads also ask Supabase Auth, so a session ended elsewhere
  // (sign-out, password reset) is refused at once, not when its token expires.
  const [profile, needsCode, { data: fresh }] = await Promise.all([
    getCurrentProfile(),
    needsTwoStepCode(),
    supabase.auth.getUser(),
  ]);
  if (!profile || !profile.is_active || fresh.user?.id !== profile.id) return null;
  if (needsCode) return null;
  if ((options.admin || options.mainAdmin) && !profile.is_admin) return null;
  if (options.mainAdmin && !(await mainAdminUnlocked(profile))) return null;
  if (options.page) {
    const level = pageAccess(profile, options.page);
    if (level === "none" || (options.edit && level !== "edit")) return null;
    if (!profile.is_admin && !(await getAuthSession())?.twoStepVerified) return null;
  }
  return { profile, supabase };
}

export const NOT_ALLOWED = "You are not signed in or not allowed to do this.";
