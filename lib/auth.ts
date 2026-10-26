import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { Profile } from "@/lib/database.types";
import { isProfileComplete } from "@/lib/profile-completion";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user's profile, or null. Cached per request.
 * Uses getUser() so the session is verified with Supabase Auth.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return profile ?? null;
});

/** For pages: redirect to login if signed out, sign out if deactivated. */
export async function requireUser(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.is_active) redirect("/auth/signout?reason=inactive");
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

/** For main-admin pages (Analytics, Rates): other admins go to the admin overview. */
export async function requireMainAdmin(): Promise<Profile> {
  const profile = await requireAdmin();
  if (!profile.is_main_admin) redirect("/admin");
  return profile;
}

/**
 * For Server Actions and Route Handlers: never trust the client, re-check here.
 * Returns null instead of redirecting so the action can return an error.
 */
export async function getActionContext(options: { admin?: boolean; mainAdmin?: boolean } = {}) {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active) return null;
  if ((options.admin || options.mainAdmin) && !profile.is_admin) return null;
  if (options.mainAdmin && !profile.is_main_admin) return null;
  const supabase = await createClient();
  return { profile, supabase };
}

export const NOT_ALLOWED = "You are not signed in or not allowed to do this.";
