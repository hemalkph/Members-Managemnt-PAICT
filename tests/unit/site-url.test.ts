import { afterEach, describe, expect, test, vi } from "vitest";
import { getMetadataBase } from "@/lib/core/env";

afterEach(() => vi.unstubAllEnvs());

describe("getMetadataBase", () => {
  test("uses the site URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://team.example/");
    expect(getMetadataBase()?.origin).toBe("https://team.example");
  });

  test("a site URL without https:// does not throw", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "team.example");
    expect(() => getMetadataBase()).not.toThrow();
    expect(getMetadataBase()).toBeUndefined();
  });
});
