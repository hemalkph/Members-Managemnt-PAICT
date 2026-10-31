import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ScanBarcodeIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PackingBoard } from "@/components/dispatch/packing-board";
import { ProblemList } from "@/components/dispatch/problem-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireDispatch } from "@/lib/dispatch/access";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

import { getT } from "@/lib/dispatch/i18n/server";
export const metadata: Metadata = { title: "Packing – Tute dispatch" };

export default async function PackingPage({ params }: PageProps<"/admin/dispatch/rounds/[id]/packing">) {
  const t = await getT();
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { caps } = await requireDispatch("plan");
  const supabase = await createClient();
  const [{ data: round }, { data: list }, { data: packers }, { data: problems }] = await Promise.all([
    supabase.from("dispatch_rounds").select("id, name, state").eq("id", id).maybeSingle(),
    supabase.rpc("dispatch_pack_list", { p_round: id }),
    supabase.rpc("dispatch_packers"),
    supabase
      .from("parcel_exceptions")
      .select("id, kind, note, opened_by, opened_at, parcels!inner(reference)")
      .eq("round_id", id)
      .is("resolved_at", null)
      .order("opened_at"),
  ]);
  if (!round) notFound();
  const nameOf = new Map((packers ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Packing")}
        description={`${round.name} · ${t("assign parcels, print the packing list, sort out problems")}`}
        actions={
          <>
            <Button asChild variant="outline" className="print:hidden">
              <Link href={`/admin/dispatch/rounds/${id}`}>
                <ArrowLeftIcon /> {t("Round")}
              </Link>
            </Button>
            {(caps.has("pack") || caps.has("verify")) && (
              <Button asChild className="print:hidden">
                <Link href={`/admin/dispatch/rounds/${id}/scan`}>
                  <ScanBarcodeIcon /> {t("Packing station")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>{t("Parcels on hold")}</CardTitle>
          <CardDescription>
            {t("Reported at the packing station. Mark each one fixed when it is sorted.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProblemList
            roundId={id}
            canResolve={caps.has("plan")}
            problems={(problems ?? []).map((p) => ({
              id: p.id,
              reference: (p.parcels as unknown as { reference: string }).reference,
              kind: p.kind,
              note: p.note,
              openedBy: (p.opened_by && nameOf.get(p.opened_by)) || t("A packer"),
              when: formatDateTime(p.opened_at),
            }))}
          />
        </CardContent>
      </Card>
      <PackingBoard
        roundId={id}
        roundName={round.name}
        packers={packers ?? []}
        canUnpack={caps.has("correct")}
        rows={(list ?? []).map((r) => ({
          id: r.parcel_id,
          reference: r.reference,
          trackingNo: r.tracking_no,
          studentNo: r.student_no,
          items: r.items ?? "",
          packState: r.pack_state,
          onHold: r.on_hold,
          registered: r.registration_state === "registered",
          assignedTo: r.assigned_to,
          assignedName: r.assigned_name,
          packedName: r.packed_name,
          verifiedName: r.verified_name,
          rowVersion: r.row_version,
        }))}
      />
    </div>
  );
}
