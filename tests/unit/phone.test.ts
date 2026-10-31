import { describe, expect, test } from "vitest";
import { looksLikeFormula, normalisePhone } from "@/lib/dispatch/phone";

describe("normalisePhone", () => {
  test.each([
    ["0771234567", "0771234567", "ok"],
    ["771234567", "0771234567", "fixed"],
    ["077 1163730", "0771163730", "fixed"],
    ["077-123-4567", "0771234567", "fixed"],
    ["+94771234567", "0771234567", "fixed"],
    ["94771234567", "0771234567", "fixed"],
    ["(077) 123 4567", "0771234567", "fixed"],
  ])("%s → %s (%s)", (raw, value, status) => {
    const r = normalisePhone(raw);
    expect(r.value).toBe(value);
    expect(r.status).toBe(status);
    expect(r.raw).toBe(raw);
  });

  test("a formula-like value is cleaned but marked for review", () => {
    const r = normalisePhone("=+94741043970");
    expect(r).toMatchObject({ value: "0741043970", status: "review", raw: "=+94741043970" });
  });

  test("a 9-digit number that isn't a mobile gets a 0 but needs a look", () => {
    expect(normalisePhone("812345678")).toMatchObject({ value: "0812345678", status: "review" });
  });

  test.each(["12345", "abc", "+44 20 7946 0958", "07712345678"])("%s is invalid and kept as raw text", (raw) => {
    expect(normalisePhone(raw)).toMatchObject({ value: null, status: "invalid", raw });
  });

  test("empty stays empty", () => {
    expect(normalisePhone("  ")).toMatchObject({ value: null, status: "empty" });
  });
});

describe("looksLikeFormula", () => {
  test.each(["=1+1", "@SUM(A1)", "\tx", "\rx"])("%j is formula-like", (v) => expect(looksLikeFormula(v)).toBe(true));
  test.each(["+94771234567", "Kandy", "-"])("%j is not", (v) => expect(looksLikeFormula(v)).toBe(false));
});
