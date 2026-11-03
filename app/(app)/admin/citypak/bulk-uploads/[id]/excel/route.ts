import type { NextRequest } from "next/server";
import { serveCitypakDocument } from "@/lib/citypak/documents";

/** Citypak's filled Excel for a bulk-upload batch (courier only, streamed, logged). */
export async function GET(request: NextRequest, { params }: RouteContext<"/admin/citypak/bulk-uploads/[id]/excel">) {
  const { id } = await params;
  return serveCitypakDocument(request, id, "excel");
}
