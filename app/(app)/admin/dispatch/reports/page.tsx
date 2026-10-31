import type { Metadata } from "next";
import Link from "next/link";
import { DownloadIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireDispatch } from "@/lib/dispatch/access";
import { reportRange } from "@/lib/dispatch/money";
import { monthLabelFromDate, ROUND_STATE, type RoundState } from "@/lib/dispatch/rounds";
import { formatLKR } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PackageIcon, TruckIcon, Undo2Icon, BanknoteIcon } from "lucide-react";

export const metadata: Metadata = { title: "Reports – Tute dispatch" };

export default async function ReportsPage({ searchParams }: PageProps<"/admin/dispatch/reports">) {
  const { caps } = await requireDispatch(["plan", "finance", "courier"]);
  const sp = await searchParams;
  const range = reportRange(typeof sp.from === "string" ? sp.from : undefined, typeof sp.to === "string" ? sp.to : undefined);
  const money = caps.has("finance");
  const seesPeople = caps.has("plan") || money;
  const supabase = await createClient();
  const args = { p_from: `${range.from}-01`, p_to: `${range.to}-01` };
  const [{ data: rounds }, { data: people }] = await Promise.all([
    supabase.rpc("dispatch_report_rounds", args),
    seesPeople ? supabase.rpc("dispatch_report_people", args) : Promise.resolve({ data: [] as never[] }),
  ]);
  const list = rounds ?? [];
  const sum = (k: "live" | "delivered" | "returned" | "replacements") => list.reduce((s, r) => s + r[k], 0);
  const sumMoney = (k: "cod_expected" | "cod_paid" | "cod_outstanding") => list.reduce((s, r) => s + Number(r[k] ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Rounds sent in the chosen months: what went out, what arrived, what came back and the COD money."
        actions={
          <Button asChild variant="outline">
            <a href={`/admin/dispatch/reports/export?from=${range.from}&to=${range.to}`}>
              <DownloadIcon /> Download Excel
            </a>
          </Button>
        }
      />
      <form className="flex flex-wrap items-end gap-3" action="/admin/dispatch/reports">
        <div className="space-y-1.5">
          <Label htmlFor="from">From month</Label>
          <Input id="from" name="from" type="month" defaultValue={range.from} className="w-44" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To month</Label>
          <Input id="to" name="to" type="month" defaultValue={range.to} className="w-44" />
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Parcels sent" value={sum("live")} icon={PackageIcon} hint={`${sum("replacements")} were resent`} />
        <StatCard label="Delivered" value={sum("delivered")} icon={TruckIcon} tone="success" delay={0.1} />
        <StatCard label="Returned" value={sum("returned")} icon={Undo2Icon} tone={sum("returned") > 0 ? "warning" : "success"} delay={0.2} />
        {money ? (
          <StatCard
            label="COD received"
            value={Math.round(sumMoney("cod_paid"))}
            prefix="Rs. "
            icon={BanknoteIcon}
            tone="info"
            hint={`of ${formatLKR(sumMoney("cod_expected"))} · ${formatLKR(sumMoney("cod_outstanding"))} owed`}
            delay={0.3}
          />
        ) : (
          <StatCard label="COD expected" value={Math.round(sumMoney("cod_expected"))} prefix="Rs. " icon={BanknoteIcon} tone="info" hint="From delivered parcels" delay={0.3} />
        )}
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Round</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Delivered</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Returned</TableHead>
              <TableHead className="hidden text-right md:table-cell">Not finished</TableHead>
              <TableHead className="text-right">COD expected</TableHead>
              {money && <TableHead className="hidden text-right lg:table-cell">Received</TableHead>}
              {money && <TableHead className="pr-4 text-right">Owed</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground py-6 text-center text-sm">
                  No rounds were sent in these months.
                </TableCell>
              </TableRow>
            )}
            {list.map((r) => (
              <TableRow key={r.round_id}>
                <TableCell className="pl-4">
                  <Link href={`/admin/dispatch/rounds/${r.round_id}`} className="font-medium underline-offset-4 hover:underline">
                    {r.name}
                  </Link>
                  <span className="text-muted-foreground flex items-center gap-2 text-xs">
                    {monthLabelFromDate(r.sending_month)}
                    <Badge variant={ROUND_STATE[r.state as RoundState].variant}>{ROUND_STATE[r.state as RoundState].label}</Badge>
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.live}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.delivered}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.returned}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{r.unresolved}</TableCell>
                <TableCell className="text-right tabular-nums">{formatLKR(Number(r.cod_expected))}</TableCell>
                {money && <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatLKR(Number(r.cod_paid ?? 0))}</TableCell>}
                {money && <TableCell className="pr-4 text-right tabular-nums">{formatLKR(Number(r.cod_outstanding ?? 0))}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {seesPeople && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Who did the work</h2>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead className="text-right">Packed</TableHead>
                  <TableHead className="text-right">Verified</TableHead>
                  <TableHead className="pr-4 text-right">Handed over</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(people ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground py-6 text-center text-sm">
                      Nothing packed yet in these months.
                    </TableCell>
                  </TableRow>
                )}
                {(people ?? []).map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-4">{p.name ?? "Former member"}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.packed}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.verified}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{p.handed_over}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      )}
    </div>
  );
}
