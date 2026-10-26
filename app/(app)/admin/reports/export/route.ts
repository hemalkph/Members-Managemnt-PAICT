import { NextResponse, type NextRequest } from "next/server";
import { getActionContext } from "@/lib/auth";
import { parseMonthParam } from "@/lib/month";
import { csvCell, getMonthlyReport } from "@/lib/report";

/** CSV of approved work per member per role for ?month=YYYY-MM (admins only). */
export async function GET(request: NextRequest) {
  const ctx = await getActionContext({ admin: true });
  if (!ctx) return new NextResponse("Not allowed", { status: 403 });

  const month = parseMonthParam(request.nextUrl.searchParams.get("month") ?? undefined);
  const report = await getMonthlyReport(ctx.supabase, month);

  const lines = [
    ["Month", "Member", "Email", "Section", "Role", "Approved submissions", "Total quantity"].map(csvCell).join(","),
    ...report.flatMap((m) =>
      m.lines.map((l) => [month, m.name, m.email, l.sectionName, l.roleName, l.count, l.quantity].map(csvCell).join(",")),
    ),
  ];

  // BOM so Excel opens UTF-8 (e.g. Sinhala / Tamil names) correctly.
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="work-report-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
