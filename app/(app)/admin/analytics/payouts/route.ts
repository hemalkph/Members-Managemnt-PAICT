import { NextResponse, type NextRequest } from "next/server";
import { getAnalytics } from "@/lib/analytics";
import { getActionContext } from "@/lib/auth";
import { PAYROLL_CSV_INCLUDES_FULL_ACCOUNT_NUMBER } from "@/lib/config";
import { maskAccountNumber } from "@/lib/format";
import { parseMonthParam } from "@/lib/month";
import { csvCell } from "@/lib/report";

/**
 * Payroll CSV for ?month=YYYY-MM (main admins only): one row per member with
 * bank details, fixed salary, approved work amount and the total to pay.
 */
export async function GET(request: NextRequest) {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return new NextResponse("Not allowed", { status: 403 });

  const month = parseMonthParam(request.nextUrl.searchParams.get("month") ?? undefined);
  const data = await getAnalytics(ctx.supabase, month, 1);

  const ids = data.payouts.map((p) => p.userId);
  const { data: banks } = ids.length
    ? await ctx.supabase
        .from("bank_details")
        .select("user_id, bank_name, branch, account_holder, account_number, account_last4")
        .in("user_id", ids)
    : { data: [] };
  const bankByUser = new Map((banks ?? []).map((b) => [b.user_id, b]));

  const header = [
    "Month",
    "Member",
    "Email",
    "Phone",
    "Bank",
    "Branch",
    "Account holder",
    "Account number",
    "Salaried role(s)",
    "Salary (Rs.)",
    "Approved items",
    "Approved units",
    "Work amount (Rs.)",
    "Total to pay (Rs.)",
    "Pending review (Rs.)",
  ];

  const rows = data.payouts
    .filter((p) => p.total > 0 || p.pending > 0)
    .map((p) => {
      const bank = bankByUser.get(p.userId);
      const account = bank
        ? PAYROLL_CSV_INCLUDES_FULL_ACCOUNT_NUMBER
          ? bank.account_number
          : maskAccountNumber(bank.account_last4)
        : "";
      return [
        month,
        p.name,
        p.email,
        p.phone ?? "",
        bank?.bank_name ?? "NOT ADDED",
        bank?.branch ?? "",
        bank?.account_holder ?? "",
        account,
        p.salaryRoles.join(" / "),
        p.salary.toFixed(2),
        p.approvedItems,
        p.approvedUnits,
        p.spent.toFixed(2),
        p.total.toFixed(2),
        p.pending.toFixed(2),
      ];
    });

  const totals = data.payouts.reduce(
    (t, p) => ({
      salary: t.salary + p.salary,
      work: t.work + p.spent,
      total: t.total + p.total,
      pending: t.pending + p.pending,
    }),
    { salary: 0, work: 0, total: 0, pending: 0 },
  );
  const totalRow = [
    month,
    "TOTAL",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    totals.salary.toFixed(2),
    "",
    "",
    totals.work.toFixed(2),
    totals.total.toFixed(2),
    totals.pending.toFixed(2),
  ];

  const ACCOUNT_COLUMN = header.indexOf("Account number");
  // Account numbers are digits only (validated), so ="0081..." is safe and keeps leading zeros in Excel.
  const cell = (value: string | number, index: number) =>
    index === ACCOUNT_COLUMN && typeof value === "string" && /^[0-9]+$/.test(value)
      ? `"=""${value}"""`
      : csvCell(value);
  const lines = [header.map(csvCell).join(","), ...[...rows, totalRow].map((r) => r.map(cell).join(","))];

  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
