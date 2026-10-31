import { NextResponse, type NextRequest } from "next/server";
import { getActionContext } from "@/lib/auth";
import { reportRange, reportWorkbook } from "@/lib/dispatch/reports";

/** Downloads the dispatch report as Excel. The database checks who may see what. */
export async function GET(request: NextRequest) {
  const ctx = await getActionContext({ page: "dispatch" });
  if (!ctx) return NextResponse.redirect(new URL("/login", request.url));
  const range = reportRange(request.nextUrl.searchParams.get("from") ?? undefined, request.nextUrl.searchParams.get("to") ?? undefined);
  const args = { p_from: `${range.from}-01`, p_to: `${range.to}-01` };
  const [{ data: rounds, error }, { data: people }, { data: finance }] = await Promise.all([
    ctx.supabase.rpc("dispatch_report_rounds", args),
    ctx.supabase.rpc("dispatch_report_people", args),
    ctx.supabase.rpc("has_dispatch", { p_cap: "finance" }),
  ]);
  if (error) return new NextResponse("Not allowed", { status: 403 });
  const bytes = await reportWorkbook(range, rounds ?? [], people ?? [], finance === true);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tute-dispatch-${range.from}-to-${range.to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
