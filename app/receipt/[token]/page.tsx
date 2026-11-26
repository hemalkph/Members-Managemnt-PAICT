import type { Metadata } from "next";
import { PAYSLIP_ORGANISATION } from "@/lib/core/config";
import { formatDateNumeric, formatLKR } from "@/lib/core/format";
import { dateToMonthKey, monthLabel } from "@/lib/core/month";
import { code39Bars } from "@/lib/payments/code39";
import { isReceiptToken } from "@/lib/payments/receipt";
import { createClient } from "@/lib/supabase/server";
import { ReceiptPaper } from "./receipt-paper";

// Never reads the database, so the preview never shows a name or amount.
export const metadata: Metadata = {
  title: "Salary receipt",
  description: PAYSLIP_ORGANISATION,
  robots: { index: false, follow: false },
};

// Amounts on the slip, without the "Rs." (the total line prints it once).
const amount = (n: number) => (n > 0 ? formatLKR(n).replace(/^Rs\.\s*/, "") : null);

export default async function ReceiptPage({ params }: PageProps<"/receipt/[token]">) {
  const { token } = await params;
  const r = isReceiptToken(token)
    ? (await (await createClient()).rpc("payout_receipt", { p_token: token }).maybeSingle()).data
    : null;

  return (
    <ReceiptPaper
      organisation={PAYSLIP_ORGANISATION}
      receipt={
        r && {
          firstName: r.first_name,
          monthLabel: monthLabel(dateToMonthKey(r.month)),
          payslipNo: r.payslip_no,
          salary: amount(Number(r.salary_amount)),
          work: amount(Number(r.work_amount)),
          items: r.approved_items,
          total: Number(r.total_amount),
          paidOn: formatDateNumeric(r.paid_on),
          reference: r.payment_reference,
          bars: code39Bars(r.payslip_no),
        }
      }
    />
  );
}
