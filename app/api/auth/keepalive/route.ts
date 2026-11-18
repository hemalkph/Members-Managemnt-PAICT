import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { isCurrentRequestIdleExpired, setLastActiveCookie } from "@/lib/auth/idle-cookie";

const json = (body: { ok: boolean }, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Refreshes the idle activity cookie while the user is actively interacting on a page. */
export async function POST() {
  const [session, expired] = await Promise.all([getAuthSession(), isCurrentRequestIdleExpired()]);
  if (!session || expired) return json({ ok: false }, 401);

  await setLastActiveCookie();
  return json({ ok: true });
}
