import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { SettlementForm } from "@/components/dispatch/settlement-form";
import { SettlementLines } from "@/components/dispatch/settlement-lines";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireDispatch } from "@/lib/dispatch/access";
import type { DeliveryState } from "@/lib/dispatch/delivery";
import { SETTLEMENT_STATE } from "@/lib/dispatch/money";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Settlement – Tute dispatch" };

export default async function SettlementPage({ params }: PageProps<"/admin/dispatch/money/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { caps } = await requireDispatch("finance");
  const supabase = await createClient();
  const [{ data: s }, { data: lines }, { data: list }] = await Promise.all([
    supabase.from("cod_settlements").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("cod_settlement_lines")
      .select("id, collected, fee, added_at, parcels!inner(reference, tracking_no, delivery_state, cod_expected, dispatch_rounds(name))")
      .eq("settlement_id", id)
      .order("added_at")
      .limit(5000),
    supabase.rpc("dispatch_settlements"),
  ]);
  if (!s) notFound();
  const summary = (list ?? []).find((x) => x.id === id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Settlement ${s.reference}`}
        description={
          s.state === "confirmed"
            ? `Confirmed ${formatDateTime(s.confirmed_at)}${summary?.confirmed_name ? ` by ${summary.confirmed_name}` : ""}`
            : s.state === "cancelled"
              ? `Cancelled ${formatDateTime(s.cancelled_at)}${s.cancel_reason ? ` – ${s.cancel_reason}` : ""}`
              : "Draft – the parcels don't count as paid until you confirm."
        }
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={SETTLEMENT_STATE[s.state].variant}>{SETTLEMENT_STATE[s.state].label}</Badge>
            <Button asChild variant="outline">
              <Link href="/admin/dispatch/money">
                <ArrowLeftIcon /> COD money
              </Link>
            </Button>
          </div>
        }
      />
      <Card>
        <CardContent>
          <SettlementForm
            initial={{ id: s.id, reference: s.reference, settled_on: s.settled_on, remitted: Number(s.remitted), note: s.note }}
            disabled={s.state !== "draft"}
          />
          {s.dispute_note && <p className="mt-3 text-sm text-amber-700 dark:text-warning">Difference explained: {s.dispute_note}</p>}
        </CardContent>
      </Card>
      <SettlementLines
        settlementId={s.id}
        state={s.state}
        remitted={Number(s.remitted)}
        fileId={s.file_id}
        canCancelConfirmed={caps.has("correct")}
        lines={(lines ?? []).map((l) => {
          const p = l.parcels as unknown as {
            reference: string;
            tracking_no: string | null;
            delivery_state: DeliveryState;
            cod_expected: number;
            dispatch_rounds: { name: string } | null;
          };
          return {
            id: l.id,
            reference: p.reference,
            trackingNo: p.tracking_no,
            roundName: p.dispatch_rounds?.name ?? "",
            deliveryState: p.delivery_state,
            codExpected: Number(p.cod_expected),
            collected: Number(l.collected),
            fee: Number(l.fee),
          };
        })}
      />
    </div>
  );
}
