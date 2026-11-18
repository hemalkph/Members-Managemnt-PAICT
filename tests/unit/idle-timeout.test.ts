import { describe, expect, it } from "vitest";

import {
  IDLE_PING_INTERVAL_MS,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
  SERVER_IDLE_TIMEOUT_MS,
  idleCookieOptions,
  isIdleExpired,
  parseLastActive,
} from "@/lib/auth/idle-timeout";

describe("idle-timeout", () => {
  it("uses a 15-minute idle timeout with a 60-second warning", () => {
    expect(IDLE_TIMEOUT_MS).toBe(15 * 60 * 1000);
    expect(IDLE_WARNING_MS).toBe(60 * 1000);
  });

  it("parses valid timestamps and rejects missing or malformed cookies", () => {
    expect(parseLastActive("1794990000000")).toBe(1794990000000);
    expect(parseLastActive(undefined)).toBeNull();
    expect(parseLastActive(null)).toBeNull();
    expect(parseLastActive("")).toBeNull();
    expect(parseLastActive("abc")).toBeNull();
    expect(parseLastActive("-100")).toBeNull();
    expect(parseLastActive("0")).toBeNull();
  });

  it("treats missing timestamps as not expired and flags elapsed >= 15 minutes plus one ping of grace", () => {
    const now = 2_000_000_000_000;
    expect(isIdleExpired(null, now)).toBe(false);
    expect(isIdleExpired(undefined, now)).toBe(false);
    expect(SERVER_IDLE_TIMEOUT_MS).toBe(IDLE_TIMEOUT_MS + IDLE_PING_INTERVAL_MS);
    expect(isIdleExpired(now - IDLE_TIMEOUT_MS, now)).toBe(false);
    expect(isIdleExpired(now - (SERVER_IDLE_TIMEOUT_MS - 1), now)).toBe(false);
    expect(isIdleExpired(now - SERVER_IDLE_TIMEOUT_MS, now)).toBe(true);
  });

  it("sets httpOnly cookie options with lifetime longer than the idle window", () => {
    const opts = idleCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge * 1000).toBeGreaterThan(IDLE_TIMEOUT_MS);
  });
});
