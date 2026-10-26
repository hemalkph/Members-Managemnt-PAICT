import { NextResponse, type NextRequest } from "next/server";
import { getAnalytics } from "@/lib/analytics";
import { getActionContext } from "@/lib/auth";
import { maskAccountNumber } from "@/lib/format";
import { parseMonthParam } from "@/lib/month";
import { csvCell } from "@/lib/report";

/** CSV of what each member is owed for ?month=YYYY-MM (main admins only). */
export async function GET(request: NextRequest) {
  const ctx = await getActionContext({ mainAdmin: true });
  if (!ctx) return new NextResponse("Not allowed", { status: 403 });

  const month = parseMonthParam(request.nextUrl.searchParams.get("month") ?? undefined);
  const data = await getAnalytics(ctx.supabase, month, 1);

  const lines = [
    ["Month", "Member", "Email", "Bank", "Account", "Approved items", "Approved units", "Amount (Rs.)", "Pending (Rs.)"]
      .map(csvCell)
      .join(","),
    ...data.payouts.map((p) =>
      [
        month,
        p.name,
        p.email,
        p.bankName ?? "",
        p.bankLast4 ? maskAccountNumber(p.bankLast4) : "",
        p.approvedItems,
        p.approvedUnits,
        p.spent.toFixed(2),
        p.pending.toFixed(2),
      ]
        .map(csvCell)
        .join(","),
    ),
  ];

  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payouts-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
