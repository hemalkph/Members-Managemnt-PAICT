import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles links from Supabase emails (invite, sign-up confirm, and password
 * recovery for main admins). Supports both the token_hash flow and the PKCE ?code= flow.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  let next = safeNext(searchParams.get("next"), request.url);

  // Invited and recovering users must choose a password first.
  if (type === "invite" || type === "recovery") next = "/reset-password";

  const supabase = await createClient();
  let ok = false;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  // Only main admins reset their own password by email; everyone else asks a main admin.
  if (ok && type === "recovery") {
    const { data } = await supabase.auth.getClaims();
    const { data: me } = await supabase
      .from("profiles")
      .select("is_main_admin")
      .eq("id", data?.claims?.sub ?? "")
      .maybeSingle();
    if (!me?.is_main_admin) {
      await supabase.auth.signOut();
      const refused = new URL("/login", request.url);
      refused.searchParams.set("error", "reset");
      return NextResponse.redirect(refused);
    }
  }

  const url = new URL(ok ? next : "/login", request.url);
  if (!ok) url.searchParams.set("error", "link");
  return NextResponse.redirect(url);
}
