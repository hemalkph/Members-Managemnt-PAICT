import type { NextRequest } from "next/server";
import { serveCitypakDocument } from "@/lib/citypak/documents";

/** Waybill PDF for a bulk-upload batch, ?size=4X6 (courier only, streamed, logged). */
export async function GET(request: NextRequest, { params }: RouteContext<"/admin/citypak/bulk-uploads/[id]/waybills">) {
  const { id } = await params;
  return serveCitypakDocument(request, id, "waybills");
}
