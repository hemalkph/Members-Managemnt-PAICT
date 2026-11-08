import { describe, expect, it } from "vitest";

import { safeNext } from "@/lib/auth/safe-next";

const base = "https://app.example/auth/confirm?token_hash=x";

describe("safeNext", () => {
  it("keeps pages inside the app", () => {
    expect(safeNext("/dashboard", base)).toBe("/dashboard");
    expect(safeNext("/work?month=2026-11#top", base)).toBe("/work?month=2026-11#top");
  });

  it("refuses other websites, however they are written", () => {
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "/\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "evil.example",
      "",
      null,
    ]) {
      expect(safeNext(value, base)).toBe("/");
    }
  });

  it("never returns a value the browser could read as another host", () => {
    for (const value of ["/\\evil.example", "/%5Cevil.example", "/.//evil.example", "/x/..//evil.example"]) {
      const out = safeNext(value, base);
      expect(new URL(out, base).origin).toBe("https://app.example");
    }
  });
});
