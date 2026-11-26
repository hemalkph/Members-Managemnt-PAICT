import { formatDateNumeric, formatLKR } from "@/lib/core/format";
import { monthLabel } from "@/lib/core/month";
import { uuid } from "@/lib/core/validation";

/** What a salary receipt message needs. Shared by the Payments page (browser) and tests. */
export type ReceiptInput = {
  memberName: string;
  monthKey: string;
  payslipNo: string;
  salary: number;
  work: number;
  items: number;
  total: number;
  paidOn: string;
  reference: string | null;
  token: string;
};

export function receiptUrl(siteUrl: string, token: string): string {
  return `${siteUrl}/receipt/${token}`;
}

/** True when the value can be a receipt code (a UUID), so bad links never reach the database. */
export function isReceiptToken(value: string): boolean {
  return uuid.safeParse(value).success;
}

/** The WhatsApp receipt a main admin sends a member after paying them. */
export function receiptWhatsAppText(r: ReceiptInput, siteUrl: string): string {
  const first = r.memberName.trim().split(/\s+/)[0];
  const reference = r.reference?.trim();
  const lines = [`Hi ${first}, your salary for ${monthLabel(r.monthKey)} has been paid! 🎉`, ""];
  if (r.salary > 0) lines.push(`Salary: ${formatLKR(r.salary)}`);
  if (r.work > 0) lines.push(`Work: ${formatLKR(r.work)} (${r.items} item${r.items === 1 ? "" : "s"})`);
  lines.push(`*Total: ${formatLKR(r.total)}*`, "");
  if (reference) lines.push(`Reference: ${reference}`);
  lines.push(
    `Paid on: ${formatDateNumeric(r.paidOn)}`,
    `Payslip No.: ${r.payslipNo}`,
    "",
    `View your receipt: ${receiptUrl(siteUrl, r.token)}`,
    "Thank you for your work! 🙏",
  );
  return lines.join("\n");
}

// No code means the database change hasn't run yet: a link would read "/receipt/undefined".
type Sendable = { total: number; receiptToken: string };

/** Who gets a receipt after a bulk payment: everyone paid something who has a receipt code, in table order. */
export function receiptQueue<T extends Sendable>(rows: T[]): T[] {
  return rows.filter((r) => r.total > 0 && Boolean(r.receiptToken));
}

/** A paid row can get a WhatsApp receipt. */
export function canSendReceipt(row: Sendable & { status: string }): boolean {
  return row.status === "paid" && receiptQueue([row]).length === 1;
}
