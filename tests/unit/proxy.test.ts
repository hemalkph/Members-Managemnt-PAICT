import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LAST_ACTIVE_COOKIE, SERVER_IDLE_TIMEOUT_MS } from "@/lib/auth/idle-timeout";

const mockClaims = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: mockClaims,
    },
  }),
}));

vi.mock("@/lib/core/env", () => ({
  getSupabaseUrl: () => "https://example.supabase.co",
  getSupabaseAnonKey: () => "anon-key",
}));

import { updateSession } from "@/lib/supabase/proxy";

function makeRequest(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; cookies?: Record<string, string> } = {},
) {
  const url = `https://app.example${path}`;
  const req = new NextRequest(url, {
    method: opts.method ?? "GET",
    headers: opts.headers,
  });
  for (const [k, v] of Object.entries(opts.cookies ?? {})) {
    req.cookies.set(k, v);
  }
  return req;
}

describe("updateSession", () => {
  beforeEach(() => {
    mockClaims.mockReset();
  });

  it("redirects signed-in visitors away from /login when there is no error param", async () => {
    mockClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    const res = await updateSession(makeRequest("/login"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });

  it("preserves /login?error=link for signed-in visitors so link errors are shown", async () => {
    mockClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    const res = await updateSession(makeRequest("/login?error=link"));
    expect(res.status).toBe(200);
  });

  it("redirects normal idle-expired page requests to /auth/signout?reason=idle", async () => {
    mockClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    const expiredTs = String(Date.now() - SERVER_IDLE_TIMEOUT_MS - 1000);
    const res = await updateSession(
      makeRequest("/login/two-step", { cookies: { [LAST_ACTIVE_COOKIE]: expiredTs } }),
    );
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/auth/signout");
    expect(loc.search).toBe("?reason=idle");
  });

  it("lets idle-expired Server Action POSTs reach the action without refreshing the activity cookie", async () => {
    mockClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    const expiredTs = String(Date.now() - SERVER_IDLE_TIMEOUT_MS - 1000);
    const res = await updateSession(
      makeRequest("/login/two-step", {
        method: "POST",
        headers: { "next-action": "abc123" },
        cookies: { [LAST_ACTIVE_COOKIE]: expiredTs },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.cookies.get(LAST_ACTIVE_COOKIE)).toBeUndefined();
  });

  it("does not refresh the activity cookie on Next.js 16 prefetch variants", async () => {
    mockClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
    const freshTs = String(Date.now() - 10_000);
    const r1 = await updateSession(
      makeRequest("/dashboard", {
        headers: { "next-router-prefetch": "2" },
        cookies: { [LAST_ACTIVE_COOKIE]: freshTs },
      }),
    );
    expect(r1.cookies.get(LAST_ACTIVE_COOKIE)).toBeUndefined();

    const r2 = await updateSession(
      makeRequest("/dashboard", {
        headers: { "sec-purpose": "prefetch" },
        cookies: { [LAST_ACTIVE_COOKIE]: freshTs },
      }),
    );
    expect(r2.cookies.get(LAST_ACTIVE_COOKIE)).toBeUndefined();
  });
  describe("public receipt page", () => {
    const path = "/receipt/3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f";
    const expired = () => String(Date.now() - SERVER_IDLE_TIMEOUT_MS - 1000);

    it("signed-out visitor sees /receipt", async () => {
      mockClaims.mockResolvedValue({ data: { claims: null } });
      const res = await updateSession(makeRequest(path));
      expect(res.status).toBe(200);
    });

    it("idle-expired visitor still sees /receipt", async () => {
      mockClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
      const res = await updateSession(makeRequest(path, { cookies: { [LAST_ACTIVE_COOKIE]: expired() } }));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it("idle-expired visitor is still signed out elsewhere", async () => {
      mockClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
      const res = await updateSession(makeRequest("/dashboard", { cookies: { [LAST_ACTIVE_COOKIE]: expired() } }));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/auth/signout");
    });
  });
});
