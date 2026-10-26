import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Only allow redirects to pages inside this app. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

/**
 * Handles links from Supabase emails (password reset, invite, sign-up confirm).
 * Supports both the token_hash flow and the PKCE ?code= flow.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  let next = safeNext(searchParams.get("next"));

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

  const url = new URL(ok ? next : "/login", request.url);
  if (!ok) url.searchParams.set("error", "link");
  return NextResponse.redirect(url);
}
