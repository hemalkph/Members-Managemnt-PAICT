import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, BanknoteIcon, ClockIcon, ReceiptIcon } from "lucide-react";
import { CodAttention } from "@/components/dispatch/cod-attention";
import { SettlementForm } from "@/components/dispatch/settlement-form";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireDispatch } from "@/lib/dispatch/access";
import { SETTLEMENT_STATE } from "@/lib/dispatch/money";
import { formatDate, formatLKR } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "COD money – Tute dispatch" };

export default async function MoneyPage() {
  await requireDispatch("finance");
  const supabase = await createClient();
  const [{ data: settlements }, { data: attention }] = await Promise.all([
    supabase.rpc("dispatch_settlements"),
    supabase.rpc("dispatch_cod_rows", { p_round: null, p_attention_only: true }),
  ]);
  const rows = attention ?? [];
  const owed = rows.filter((r) => r.outstanding > 0).reduce((s, r) => s + Number(r.outstanding), 0);
  const over = rows.filter((r) => r.status === "over");
  const drafts = (settlements ?? []).filter((s) => s.state === "draft");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title="COD money"
        description="Record what Citypak actually pays and match it to parcels. A delivered parcel counts as paid only after its settlement is confirmed."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Still owed" value={Math.round(owed)} prefix="Rs. " icon={BanknoteIcon} tone={owed > 0 ? "warning" : "success"} hint="Delivered, not yet paid" />
        <StatCard label="Parcels owing" value={rows.filter((r) => r.status === "unpaid" || r.status === "part_paid").length} icon={ClockIcon} delay={0.1} />
        <StatCard label="Paid too much" value={over.length} icon={AlertTriangleIcon} tone={over.length > 0 ? "warning" : "success"} hint="Check these with Citypak" delay={0.2} />
        <StatCard label="Draft settlements" value={drafts.length} icon={ReceiptIcon} tone={drafts.length > 0 ? "info" : "success"} hint="Not counted until confirmed" delay={0.3} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New settlement</CardTitle>
          <CardDescription>Enter Citypak&apos;s payment, then add the parcels it covers.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettlementForm initial={{ id: null, reference: "", settled_on: today, remitted: 0, note: "" }} />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Settlements</h2>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Reference</TableHead>
                <TableHead>Paid on</TableHead>
                <TableHead className="hidden sm:table-cell">Parcels</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="pr-4">State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(settlements ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-6 text-center text-sm">
                    No settlements yet.
                  </TableCell>
                </TableRow>
              )}
              {(settlements ?? []).map((s) => {
                const diff = Math.round((Number(s.remitted) - (Number(s.collected) - Number(s.fees))) * 100) / 100;
                return (
                  <TableRow key={s.id}>
                    <TableCell className="pl-4">
                      <Link href={`/admin/dispatch/money/${s.id}`} className="font-medium underline-offset-4 hover:underline">
                        {s.reference}
                      </Link>
                      {s.state !== "cancelled" && diff !== 0 && (
                        <span className="block text-xs text-amber-700 dark:text-warning">Differs by {formatLKR(Math.abs(diff))}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(s.settled_on)}</TableCell>
                    <TableCell className="hidden text-sm tabular-nums sm:table-cell">{s.parcels}</TableCell>
                    <TableCell className="text-sm tabular-nums">{formatLKR(Number(s.remitted))}</TableCell>
                    <TableCell className="pr-4">
                      <Badge variant={SETTLEMENT_STATE[s.state].variant}>{SETTLEMENT_STATE[s.state].label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Needs attention</h2>
        <CodAttention
          rows={rows.map((r) => ({
            parcelId: r.parcel_id,
            roundName: r.round_name,
            reference: r.reference,
            trackingNo: r.tracking_no,
            due: Number(r.due),
            paid: Number(r.paid),
            writtenOff: Number(r.written_off),
            outstanding: Number(r.outstanding),
            status: r.status,
          }))}
        />
      </section>
    </div>
  );
}
