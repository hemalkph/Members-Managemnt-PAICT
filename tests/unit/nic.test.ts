import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatDay } from "@/lib/core/format";
import { parseNic } from "@/lib/members/nic";

describe("parseNic", () => {
  it("parses old 9-digit and new 12-digit NICs", () => {
    expect(parseNic("991234567v")).toEqual({ dateOfBirth: "1999-05-02", gender: "male" });
    expect(parseNic("996234567X")).toEqual({ dateOfBirth: "1999-05-02", gender: "female" });
    expect(parseNic("200212345678")).toEqual({ dateOfBirth: "2002-05-02", gender: "male" });
    expect(parseNic("200006012345")).toEqual({ dateOfBirth: "2000-02-29", gender: "male" });
  });

  it("rejects unrealistic years (< 1900 or > 2100) so unpadded dates never slip through", () => {
    expect(parseNic("000212345678")).toBeNull();
    expect(parseNic("000012345678")).toBeNull();
    expect(parseNic("189912345678")).toBeNull();
    expect(parseNic("210112345678")).toBeNull();
    expect(parseNic("999912345678")).toBeNull();
  });

  it("rejects invalid days and non-leap-year Feb 29", () => {
    expect(parseNic("200106012345")).toBeNull();
    expect(parseNic("200200012345")).toBeNull();
    expect(parseNic("200236712345")).toBeNull();
    expect(parseNic("200286712345")).toBeNull();
  });
});

describe("date formatters", () => {
  it("return a dash instead of throwing on invalid date strings", () => {
    expect(formatDate("2-05-02T00:00:00Z")).toBe("—");
    expect(formatDate("2026-99-99")).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDay("2-05-02")).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });
});
