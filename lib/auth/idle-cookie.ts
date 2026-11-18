import "server-only";

import { cookies } from "next/headers";
import { idleCookieOptions, isIdleExpired, LAST_ACTIVE_COOKIE, parseLastActive } from "@/lib/auth/idle-timeout";

/** Record current activity on the HTTP-only session activity cookie. */
export async function setLastActiveCookie(now: number = Date.now()) {
  const cookieStore = await cookies();
  cookieStore.set(LAST_ACTIVE_COOKIE, String(now), idleCookieOptions());
}

/** Clear the session activity cookie (e.g. after server-side idle sign-out). */
export async function clearLastActiveCookie() {
  const cookieStore = await cookies();
  cookieStore.set(LAST_ACTIVE_COOKIE, "", { path: "/", maxAge: 0 });
}

/** Whether the current request's activity cookie has exceeded the idle timeout. */
export async function isCurrentRequestIdleExpired(now: number = Date.now()): Promise<boolean> {
  const cookieStore = await cookies();
  const lastActive = parseLastActive(cookieStore.get(LAST_ACTIVE_COOKIE)?.value);
  return isIdleExpired(lastActive, now);
}
