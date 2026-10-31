import { describe, expect, it } from "vitest";
import { isPdf } from "@/lib/dispatch/pdf-header";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("isPdf", () => {
  it("accepts a normal PDF header", () => {
    expect(isPdf(bytes("%PDF-1.4\n1 0 obj"))).toBe(true);
  });
  it("accepts a header after a blank line (Citypak waybills)", () => {
    expect(isPdf(bytes("\n%PDF-1.4\n1 0 obj"))).toBe(true);
    expect(isPdf(bytes("\r\n  %PDF-1.7"))).toBe(true);
  });
  it("rejects other files", () => {
    expect(isPdf(bytes("PK\u0003\u0004 not a pdf"))).toBe(false);
    expect(isPdf(bytes(""))).toBe(false);
    expect(isPdf(bytes("%PDF"))).toBe(false);
  });
  it("only looks in the first 1024 bytes", () => {
    expect(isPdf(bytes(" ".repeat(1020) + "%PDF-1.4"))).toBe(false);
    expect(isPdf(bytes(" ".repeat(1019) + "%PDF-1.4"))).toBe(true);
  });
});
