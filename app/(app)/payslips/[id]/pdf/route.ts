import { NextResponse, type NextRequest } from "next/server";
import { getActionContext } from "@/lib/auth";
import { getPayslip } from "@/lib/payslip";
import { buildPayslipPdf } from "@/lib/payslip-pdf";
import { uuid } from "@/lib/validation";

async function loadLogo(request: NextRequest): Promise<Uint8Array | null> {
  try {
    const res = await fetch(new URL("/logo.png", request.nextUrl.origin), { cache: "force-cache" });
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** Payslip PDF: the owner, or a main admin with two-step login. */
export async function GET(request: NextRequest, { params }: RouteContext<"/payslips/[id]/pdf">) {
  const ctx = await getActionContext();
  if (!ctx) return new NextResponse("Not allowed", { status: 403 });

  const { id } = await params;
  if (!uuid.safeParse(id).success) return new NextResponse("Not found", { status: 404 });

  const slip = await getPayslip(ctx.supabase, ctx.profile, id);
  if (!slip) return new NextResponse("Not found", { status: 404 });

  const pdf = await buildPayslipPdf(slip, await loadLogo(request));
  const name = slip.payout.member_name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "member";

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="payslip-${slip.monthKey}-${name}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
