// Serve a Citypak batch document (filled Excel or waybill PDF) to the browser.
// Fetched on the server per click and streamed – never stored, never cached –
// because live documents hold recipient details. Courier permission only;
// every download is logged.
import "server-only";

import { NextResponse } from "next/server";
import { getActionContext } from "@/lib/auth";
import { uuid } from "@/lib/validation";
import { canPrint, parsePrintSize } from "./bulk-uploads";
import { checkDocument, CitypakError } from "./http";
import { chooseProvider } from "./provider";

const STATUS: Record<string, number> = {
  not_found: 404,
  unsupported: 400,
  unauthorised: 502,
  bad_document: 502,
  too_large: 502,
  invalid_response: 502,
  server: 502,
  network: 504,
  rate_limited: 503,
};

const safeName = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "batch";

export async function serveCitypakDocument(request: Request, id: string, kind: "excel" | "waybills"): Promise<NextResponse> {
  const plain = (text: string, status: number) =>
    new NextResponse(text, { status, headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain" } });
  if (!uuid.safeParse(id).success) return plain("Not found", 404);

  const ctx = await getActionContext({ page: "dispatch", edit: true });
  if (!ctx) return NextResponse.redirect(new URL("/login", request.url));
  const { data: allowed } = await ctx.supabase.rpc("has_dispatch", { p_cap: "courier" });
  if (allowed !== true) return plain("Not allowed", 403);

  const choice = chooseProvider();
  if (!choice.ok) return plain("Citypak connection is not available", 503);
  const { provider } = choice;

  // RLS hides rows from people without courier/plan; the account check keeps
  // fixture rows and rows of another Citypak account out of the live provider.
  const { data: batch } = await ctx.supabase
    .from("citypak_bulk_uploads")
    .select("id, account, mode, external_id, batch_reference, status, waybills")
    .eq("id", id)
    .maybeSingle();
  if (!batch || batch.account !== provider.account || batch.mode !== provider.mode) return plain("Not found", 404);

  try {
    let doc;
    if (kind === "excel") {
      doc = await provider.filledExcel(batch.external_id);
    } else {
      const size = parsePrintSize(new URL(request.url).searchParams.get("size") ?? "4X6");
      if (!canPrint(batch)) return plain("This batch has no waybills to print", 409);
      doc = await provider.waybills(batch.external_id, size);
    }
    checkDocument(doc.bytes, doc.kind);

    const { error } = await ctx.supabase.rpc("citypak_log_document", {
      p_upload: batch.id,
      p_kind: kind === "excel" ? "filled_excel" : "waybills_4x6",
    });
    if (error) return plain("Not allowed", 403);

    const demo = batch.mode === "fixture" ? "-FIXTURE" : "";
    const name =
      kind === "excel"
        ? `citypak-${safeName(batch.batch_reference)}${demo}.xlsx`
        : `waybills-${safeName(batch.batch_reference)}-4x6${demo}.pdf`;
    return new NextResponse(Buffer.from(doc.bytes), {
      headers: {
        "Content-Type":
          doc.kind === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
        "Content-Disposition": `${kind === "excel" ? "attachment" : "inline"}; filename="${name}"`,
        "Content-Length": String(doc.bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const k = err instanceof CitypakError ? err.kind : "network";
    return plain(k === "unsupported" ? "Unsupported print size" : "The document could not be fetched", STATUS[k] ?? 502);
  }
}
