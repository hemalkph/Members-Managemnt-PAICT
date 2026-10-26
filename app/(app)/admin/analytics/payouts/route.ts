import { NextResponse, type NextRequest } from "next/server";
import { getAnalytics } from "@/lib/analytics";
import { getActionContext } from "@/lib/auth";
import { PAYROLL_CSV_INCLUDES_FULL_ACCOUNT_NUMBER } from "@/lib/config";
import { maskAccountNumber } from "@/lib/format";
import { monthLabel, parseMonthParam } from "@/lib/month";
import { getPayMonth, getPayoutsForMonth, salaryLinesOf } from "@/lib/payments";
import { csvCell } from "@/lib/report";

type CsvRow = {
  payslipNo: string;
  userId: string | null;
  name: string;
  email: string;
  phone: string;
  salaryRoles: string;
  salary: number;
  items: number;
  units: number;
  work: number;
  total: number;
  pending: number;
  status: string;
  paidOn: string;
  reference: string;
};

/**
 * Payroll CSV for ?month=YYYY-MM (main admins only): one row per member with
 * bank details, fixed salary, approved work amount and the total to pay.
 * Closed months use the amounts saved on the payslips and include the
 * payment status. Every download is recorded in the activity log.
 */
export async function GET(request: NextRequest) {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return new NextResponse("Not allowed", { status: 403 });

  const month = parseMonthParam(request.nextUrl.searchParams.get("month") ?? undefined);
  const closed = await getPayMonth(ctx.supabase, month);

  let rows: CsvRow[];
  if (closed) {
    const payouts = await getPayoutsForMonth(ctx.supabase, month);
    rows = payouts.map((p) => ({
      payslipNo: p.payslip_no,
      userId: p.user_id,
      name: p.member_name,
      email: p.member_email,
      phone: p.member_phone ?? "",
      salaryRoles: salaryLinesOf(p)
        .map((l) => l.role)
        .join(" / "),
      salary: p.salary_amount,
      items: p.approved_items,
      units: p.approved_units,
      work: p.work_amount,
      total: p.total_amount,
      pending: 0,
      status: p.status === "paid" ? "PAID" : p.total_amount > 0 ? "NOT PAID" : "NOTHING TO PAY",
      paidOn: p.paid_on ?? "",
      reference: p.payment_reference ?? "",
    }));
  } else {
    const data = await getAnalytics(ctx.supabase, month, 1);
    rows = data.payouts
      .filter((p) => p.total > 0 || p.pending > 0)
      .map((p) => ({
        payslipNo: "",
        userId: p.userId,
        name: p.name,
        email: p.email,
        phone: p.phone ?? "",
        salaryRoles: p.salaryRoles.join(" / "),
        salary: p.salary,
        items: p.approvedItems,
        units: p.approvedUnits,
        work: p.spent,
        total: p.total,
        pending: p.pending,
        status: "MONTH OPEN",
        paidOn: "",
        reference: "",
      }));
  }

  const ids = rows.map((r) => r.userId).filter((id): id is string => Boolean(id));
  const { data: banks } = ids.length
    ? await ctx.supabase
        .from("bank_details")
        .select("user_id, bank_name, branch, account_holder, account_number, account_last4")
        .in("user_id", ids)
    : { data: [] };
  const bankByUser = new Map((banks ?? []).map((b) => [b.user_id, b]));

  const header = [
    "Month",
    "Payslip no",
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
    "Status",
    "Paid on",
    "Reference",
  ];

  const lines = rows.map((r) => {
    const bank = r.userId ? bankByUser.get(r.userId) : undefined;
    const account = bank
      ? PAYROLL_CSV_INCLUDES_FULL_ACCOUNT_NUMBER
        ? bank.account_number
        : maskAccountNumber(bank.account_last4)
      : "";
    return [
      month,
      r.payslipNo,
      r.name,
      r.email,
      r.phone,
      bank?.bank_name ?? "NOT ADDED",
      bank?.branch ?? "",
      bank?.account_holder ?? "",
      account,
      r.salaryRoles,
      r.salary.toFixed(2),
      r.items,
      r.units,
      r.work.toFixed(2),
      r.total.toFixed(2),
      r.pending.toFixed(2),
      r.status,
      r.paidOn,
      r.reference,
    ];
  });

  const totals = rows.reduce(
    (t, r) => ({ salary: t.salary + r.salary, work: t.work + r.work, total: t.total + r.total, pending: t.pending + r.pending }),
    { salary: 0, work: 0, total: 0, pending: 0 },
  );
  const totalRow = [
    month,
    "",
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
    "",
    "",
    "",
  ];

  // Record who downloaded full bank details, and when.
  await ctx.supabase.rpc("log_event", {
    p_action: "payroll.exported",
    p_details: { month, month_label: monthLabel(month), rows: rows.length, closed: Boolean(closed) },
  });

  const ACCOUNT_COLUMN = header.indexOf("Account number");
  // Account numbers are digits only (validated), so ="0081..." is safe and keeps leading zeros in Excel.
  const cell = (value: string | number, index: number) =>
    index === ACCOUNT_COLUMN && typeof value === "string" && /^[0-9]+$/.test(value)
      ? `"=""${value}"""`
      : csvCell(value);
  const csv = [header.map(csvCell).join(","), ...[...lines, totalRow].map((r) => r.map(cell).join(","))];

  return new NextResponse(`﻿${csv.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
