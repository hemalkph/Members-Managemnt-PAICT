import { describe, expect, test } from "vitest";
import { formatDateNumeric } from "@/lib/core/format";
import { canSendReceipt, isReceiptToken, receiptQueue, receiptUrl, receiptWhatsAppText, type ReceiptInput } from "@/lib/payments/receipt";

const TOKEN = "3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f";
const SITE = "https://team.example";
const base: ReceiptInput = {
  memberName: "Kasun Perera",
  monthKey: "2026-10",
  payslipNo: "PS-2026-10-014",
  salary: 15000,
  work: 9500,
  items: 7,
  total: 24500,
  paidOn: "2026-11-25",
  reference: "BOC transfer 4581",
  token: TOKEN,
};

describe("formatDateNumeric", () => {
  test("plain date", () => expect(formatDateNumeric("2026-11-25")).toBe("25/11/2026"));
  test("empty", () => expect(formatDateNumeric(null)).toBe("—"));
});

describe("receiptWhatsAppText", () => {
  test("full receipt", () => {
    expect(receiptWhatsAppText(base, SITE)).toBe(
      [
        "Hi Kasun, your salary for October 2026 has been paid! 🎉",
        "",
        "Salary: Rs. 15,000.00",
        "Work: Rs. 9,500.00 (7 items)",
        "*Total: Rs. 24,500.00*",
        "",
        "Reference: BOC transfer 4581",
        "Paid on: 25/11/2026",
        "Payslip No.: PS-2026-10-014",
        "",
        `View your receipt: ${SITE}/receipt/${TOKEN}`,
        "Thank you for your work! 🙏",
      ].join("\n"),
    );
  });

  test("salary only", () => {
    const text = receiptWhatsAppText({ ...base, work: 0, items: 0, total: 15000 }, SITE);
    expect(text).not.toContain("Work:");
    expect(text).toContain("Salary: Rs. 15,000.00");
  });

  test("work only", () => {
    const text = receiptWhatsAppText({ ...base, salary: 0, total: 9500 }, SITE);
    expect(text).not.toContain("Salary:");
  });

  test("no reference", () => {
    expect(receiptWhatsAppText({ ...base, reference: null }, SITE)).not.toContain("Reference:");
    expect(receiptWhatsAppText({ ...base, reference: "  " }, SITE)).not.toContain("Reference:");
  });

  test("one item", () => {
    expect(receiptWhatsAppText({ ...base, items: 1 }, SITE)).toContain("(1 item)");
  });

  test("first name", () => {
    expect(receiptWhatsAppText({ ...base, memberName: "  Kasun Perera " }, SITE)).toMatch(/^Hi Kasun,/);
  });
});

describe("receipt link", () => {
  test("url", () => expect(receiptUrl(SITE, TOKEN)).toBe(`${SITE}/receipt/${TOKEN}`));
  test("isReceiptToken", () => {
    expect(isReceiptToken(TOKEN)).toBe(true);
    expect(isReceiptToken("abc")).toBe(false);
    expect(isReceiptToken("")).toBe(false);
    expect(isReceiptToken(TOKEN.slice(0, -1))).toBe(false);
  });
});

describe("receiptQueue", () => {
  test("drops rows without a receipt code (database not migrated yet)", () => {
    const rows = [
      { id: "a", total: 100, receiptToken: TOKEN },
      { id: "b", total: 100, receiptToken: undefined as unknown as string },
      { id: "c", total: 100, receiptToken: "" },
    ];
    expect(receiptQueue(rows).map((r) => r.id)).toEqual(["a"]);
  });

  test("canSendReceipt needs paid, above zero and a code", () => {
    expect(canSendReceipt({ status: "paid", total: 1, receiptToken: TOKEN })).toBe(true);
    expect(canSendReceipt({ status: "unpaid", total: 1, receiptToken: TOKEN })).toBe(false);
    expect(canSendReceipt({ status: "paid", total: 0, receiptToken: TOKEN })).toBe(false);
    expect(canSendReceipt({ status: "paid", total: 1, receiptToken: undefined as unknown as string })).toBe(false);
  });

  test("drops zero totals and keeps order", () => {
    const rows = [
      { id: "a", total: 100, receiptToken: TOKEN },
      { id: "b", total: 0, receiptToken: TOKEN },
      { id: "c", total: 50, receiptToken: TOKEN },
    ];
    expect(receiptQueue(rows).map((r) => r.id)).toEqual(["a", "c"]);
  });
});
