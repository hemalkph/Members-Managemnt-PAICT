import { describe, expect, test } from "vitest";
import { formatPhoneDisplay, normalizeWaPhone, pickContactPhone } from "@/lib/fees/phone";

describe("normalizeWaPhone", () => {
  test("normalizes Sri Lankan formats seen in monthly exports", () => {
    expect(normalizeWaPhone("0782480847")).toBe("94782480847");
    expect(normalizeWaPhone("94782480847")).toBe("94782480847");
    expect(normalizeWaPhone("+94 778184045")).toBe("94778184045");
    expect(normalizeWaPhone("774309816")).toBe("94774309816"); // Excel-stripped leading 0
    expect(normalizeWaPhone("077 1163730")).toBe("94771163730");
    expect(normalizeWaPhone("074 164 7004")).toBe("94741647004");
    expect(normalizeWaPhone("0094713377422")).toBe("94713377422");
    expect(normalizeWaPhone("094713377422")).toBe("94713377422");
    expect(normalizeWaPhone("940713377422")).toBe("94713377422");
  });

  test("preserves valid international numbers like Italy (+39) without adding 94", () => {
    expect(normalizeWaPhone("393246630328")).toBe("393246630328");
    expect(normalizeWaPhone("+44 7700 900077")).toBe("447700900077");
  });

  test("expands Excel scientific notation and float .0 phone numbers without corrupting digits", () => {
    expect(normalizeWaPhone("9.4782480847E10")).toBe("94782480847");
    expect(normalizeWaPhone("3.93246630328E+11")).toBe("393246630328");
    expect(normalizeWaPhone("7.74309816E+08")).toBe("94774309816");
    expect(normalizeWaPhone("94782480847.0")).toBe("94782480847");
  });

  test("rejects blank, short, or repeated fake numbers", () => {
    expect(normalizeWaPhone("")).toBeNull();
    expect(normalizeWaPhone(null)).toBeNull();
    expect(normalizeWaPhone("12345")).toBeNull();
    expect(normalizeWaPhone("0000000000")).toBeNull();
  });
});

describe("formatPhoneDisplay and pickContactPhone", () => {
  test("formats Sri Lankan and international numbers cleanly", () => {
    expect(formatPhoneDisplay("94782480847")).toBe("+94 78 248 0847");
    expect(formatPhoneDisplay("393246630328")).toBe("+393246630328");
    expect(formatPhoneDisplay(null)).toBe("—");
  });

  test("strictly returns WhatsApp number only and never falls back to Mobile", () => {
    expect(pickContactPhone("94741256235")).toEqual({ number: "94741256235", source: "whatsapp" });
    expect(pickContactPhone(null)).toEqual({ number: null, source: "none" });
  });
});
