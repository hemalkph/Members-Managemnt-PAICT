import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function signOut(request: NextRequest) {
  const supabase = await createClient();
  // Stop phone alerts for this login before ending it.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (userId) {
    const form = request.method === "POST" ? await request.formData().catch(() => null) : null;
    const endpoint = form?.get("endpoint");
    const sessionId = data.claims.session_id;
    const subs = () => supabase.from("push_subscriptions").delete().eq("user_id", userId);
    if (sessionId) await subs().eq("session_id", sessionId);
    if (typeof endpoint === "string" && endpoint.startsWith("https://") && endpoint.length <= 1000) {
      await subs().eq("endpoint", endpoint);
    }
  }
  await supabase.auth.signOut();
  const reason = request.nextUrl.searchParams.get("reason");
  const url = new URL("/login", request.url);
  if (reason === "inactive") url.searchParams.set("error", "inactive");
  if (reason === "expired") url.searchParams.set("error", "expired");
  const response = NextResponse.redirect(url, { status: 303 });
  // Always drop the login cookies, even if Supabase couldn't be reached or the
  // account no longer exists – otherwise a stale cookie keeps the user stuck.
  request.cookies
    .getAll()
    .filter((c) => c.name.startsWith("sb-"))
    .forEach((c) => response.cookies.set(c.name, "", { path: "/", maxAge: 0 }));
  return response;
}

/** Log out button (form POST). */
export async function POST(request: NextRequest) {
  return signOut(request);
}

/** Used when a deactivated member opens a page, or the login belongs to an account that no longer exists. */
export async function GET(request: NextRequest) {
  return signOut(request);
}
