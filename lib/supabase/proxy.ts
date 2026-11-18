import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";
import { idleCookieOptions, isIdleExpired, LAST_ACTIVE_COOKIE, parseLastActive } from "@/lib/auth/idle-timeout";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/core/env";

// /api/hooks: called by the database with its own secret (no login cookie).
const PUBLIC_PATHS = ["/login", "/auth", "/api/hooks"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isPrefetch(request: NextRequest) {
  return request.headers.get("next-router-prefetch") === "1" || request.headers.get("purpose") === "prefetch";
}

/** Refreshes the Supabase session cookie, enforces the idle timeout, and guards private pages. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Do not run code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;
  const now = Date.now();
  const lastActive = parseLastActive(request.cookies.get(LAST_ACTIVE_COOKIE)?.value);
  const idleExpired = signedIn && isIdleExpired(lastActive, now);
  const isApi = pathname.startsWith("/api/") && !pathname.startsWith("/api/hooks");
  const isSignOut = pathname === "/auth/signout" || pathname.startsWith("/auth/signout/");
  const isConfirm = pathname === "/auth/confirm" || pathname.startsWith("/auth/confirm/");

  const redirectTo = (path: string, search?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = search ?? "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (idleExpired && !isSignOut && !isConfirm) {
    if (isApi) {
      return NextResponse.json({ ok: false, error: "Session timed out due to inactivity." }, { status: 401 });
    }
    return redirectTo("/auth/signout", "?reason=idle");
  }

  if (!signedIn && !isPublic(pathname)) {
    if (isApi) {
      return NextResponse.json({ ok: false, error: "You are not signed in." }, { status: 401 });
    }
    return redirectTo("/login");
  }
  if (signedIn && pathname === "/login") {
    return redirectTo("/");
  }

  if (signedIn && !isSignOut && !isConfirm && (lastActive === null || !isPrefetch(request))) {
    const options = idleCookieOptions();
    request.cookies.set(LAST_ACTIVE_COOKIE, String(now));
    response.cookies.set(LAST_ACTIVE_COOKIE, String(now), options);
  }

  return response;
}
