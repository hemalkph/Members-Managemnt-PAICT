import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { canConfirm, cleanScan, CONFIRM_DELAY_MS, isConfirmShortcut, looksLikeTracking } from "@/lib/dispatch/scanner";

describe("keys", () => {
  test("a scanner's plain Enter never confirms", () => {
    expect(isConfirmShortcut({ key: "Enter" })).toBe(false);
    expect(isConfirmShortcut({ key: "Enter", shiftKey: true })).toBe(false);
    expect(isConfirmShortcut({ key: " " })).toBe(false);
    expect(isConfirmShortcut({ key: "Tab" })).toBe(false);
  });
  test("Ctrl+Enter, ⌘+Enter and F9 confirm", () => {
    expect(isConfirmShortcut({ key: "Enter", ctrlKey: true })).toBe(true);
    expect(isConfirmShortcut({ key: "Enter", metaKey: true })).toBe(true);
    expect(isConfirmShortcut({ key: "F9" })).toBe(true);
    expect(isConfirmShortcut({ key: "Enter", ctrlKey: true, altKey: true })).toBe(false);
  });
});

describe("codes", () => {
  test("cleans what a scanner or person types", () => {
    expect(cleanScan(" d16950069\r\n")).toBe("D16950069");
    expect(cleanScan("27tgroct ict088")).toBe("27TGROCTICT088");
    expect(cleanScan("x".repeat(100))).toHaveLength(64);
  });
  test("recognises Citypak tracking numbers", () => {
    expect(looksLikeTracking("D16950069")).toBe(true);
    expect(looksLikeTracking("27TGROCTICT088")).toBe(false);
  });
});

describe("confirm button", () => {
  const items = ["a", "b"];
  test("needs every tute ticked", () => {
    expect(canConfirm({ itemIds: items, ticked: new Set(["a"]), openedAt: 0, now: 5000, pending: false })).toBe(false);
    expect(canConfirm({ itemIds: items, ticked: new Set(items), openedAt: 0, now: 5000, pending: false })).toBe(true);
  });
  test("stays off just after the card opens and while saving", () => {
    expect(canConfirm({ itemIds: items, ticked: new Set(items), openedAt: 1000, now: 1000 + CONFIRM_DELAY_MS - 1, pending: false })).toBe(false);
    expect(canConfirm({ itemIds: items, ticked: new Set(items), openedAt: 0, now: 5000, pending: true })).toBe(false);
  });
});

test("the self-hosted barcode reader matches the installed package", () => {
  const hash = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
  expect(hash("public/vendor/zxing/zxing_reader-3.1.3.wasm")).toBe(hash("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm"));
  const pkg = JSON.parse(readFileSync("node_modules/zxing-wasm/package.json", "utf8"));
  expect(pkg.version).toBe("3.1.3");
});
