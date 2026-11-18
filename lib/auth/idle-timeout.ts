/** Idle auto-logout after 15 minutes of inactivity across all accounts. */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/** Show a countdown warning 60 seconds before signing out. */
export const IDLE_WARNING_MS = 60 * 1000;

/** Refresh the server activity cookie at most once per minute while the user is active. */
export const IDLE_PING_INTERVAL_MS = 60 * 1000;

/** The server cookie lags real activity by up to one ping, so it gets that much grace; otherwise "Stay logged in" can hit an already-expired cookie. */
export const SERVER_IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MS + IDLE_PING_INTERVAL_MS;

export const LAST_ACTIVE_COOKIE = "paict_last_active";

/** Cookie lifetime outlives the 15-minute idle window so expired sessions stay distinguishable from missing cookies. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function idleCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

/** Parse a stored epoch-ms timestamp cookie value, returning null when missing or invalid. */
export function parseLastActive(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** True when a valid last-activity timestamp is at least `timeoutMs` (server grace included) in the past. */
export function isIdleExpired(
  lastActiveMs: number | null | undefined,
  now: number = Date.now(),
  timeoutMs: number = SERVER_IDLE_TIMEOUT_MS,
): boolean {
  if (lastActiveMs == null || !Number.isFinite(lastActiveMs) || lastActiveMs <= 0) return false;
  return now - lastActiveMs >= timeoutMs;
}
