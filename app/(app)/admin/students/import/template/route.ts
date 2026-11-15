import { NextResponse, type NextRequest } from "next/server";
import { getActionContext } from "@/lib/auth";
import { getClassOptions } from "@/lib/organisation/classes";
import { toCsv } from "@/lib/students/csv";
import { paymentTemplate, studentTemplate } from "@/lib/students/import";

/** The CSV template: ?kind=students (default) or ?kind=payments. The example row uses a real batch and centre. */
export async function GET(request: NextRequest) {
  const ctx = await getActionContext({ page: "students" });
  if (!ctx) return NextResponse.redirect(new URL("/login", request.url));

  const payments = request.nextUrl.searchParams.get("kind") === "payments";
  let rows: string[][];
  if (payments) {
    rows = paymentTemplate();
  } else {
    const options = await getClassOptions(ctx.supabase);
    rows = studentTemplate(options.batches.find((b) => b.isActive)?.name, options.centres.find((c) => c.isActive)?.name);
  }
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="concession-${payments ? "payments" : "students"}-template.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
