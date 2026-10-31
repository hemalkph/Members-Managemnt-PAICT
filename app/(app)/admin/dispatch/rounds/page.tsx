import type { Metadata } from "next";
import Link from "next/link";
import { PackageIcon, PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { requireDispatch } from "@/lib/dispatch/access";
import { monthLabelFromDate, nextStep, ROUND_STATE, type RoundCounts } from "@/lib/dispatch/rounds";
import { createClient } from "@/lib/supabase/server";

import { getT } from "@/lib/dispatch/i18n/server";
export const metadata: Metadata = { title: "Rounds – Tute dispatch" };

export default async function RoundsPage() {
  const t = await getT();
  const { caps } = await requireDispatch();
  const supabase = await createClient();
  const [{ data: rounds }, { data: parcels }, { data: batches }] = await Promise.all([
    supabase
      .from("dispatch_rounds")
      .select("id, name, batch_id, sending_month, state, ref_prefix, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("parcels").select("round_id, registration_state, pack_state, on_hold").limit(20000),
    supabase.from("batches").select("id, name"),
  ]);
  const batchName = new Map((batches ?? []).map((b) => [b.id, b.name]));
  const counts = new Map<string, RoundCounts>();
  for (const p of parcels ?? []) {
    const c = counts.get(p.round_id) ?? { parcels: 0, registered: 0, voided: 0, packed: 0, verified: 0, onHold: 0 };
    c.parcels += 1;
    if (p.registration_state === "registered") c.registered += 1;
    if (p.registration_state === "voided") c.voided += 1;
    else if (p.pack_state !== "planned") c.packed = (c.packed ?? 0) + 1;
    if (p.pack_state === "verified") c.verified = (c.verified ?? 0) + 1;
    if (p.on_hold) c.onHold = (c.onHold ?? 0) + 1;
    counts.set(p.round_id, c);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Dispatch rounds")}
        description={t("Each round sends a set of tutes to chosen students of one batch.")}
        actions={
          caps.has("plan") ? (
            <Button asChild>
              <Link href="/admin/dispatch/rounds/new">
                <PlusIcon /> {t("New round")}
              </Link>
            </Button>
          ) : undefined
        }
      />
      {!rounds || rounds.length === 0 ? (
        <EmptyState
          icon={PackageIcon}
          title={t("No rounds yet")}
          description={t("Create a round to plan which tutes go to which students.")}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rounds.map((r) => {
            const c = counts.get(r.id) ?? { parcels: 0, registered: 0, voided: 0 };
            const live = c.parcels - c.voided;
            return (
              <Link key={r.id} href={`/admin/dispatch/rounds/${r.id}`} className="group">
                <Card className="group-hover:border-primary/50 h-full gap-3 transition-colors">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="leading-snug">{r.name}</CardTitle>
                      <Badge variant={ROUND_STATE[r.state].variant}>{t(ROUND_STATE[r.state].label)}</Badge>
                    </div>
                    <CardDescription>
                      {batchName.get(r.batch_id) ?? "—"} · {monthLabelFromDate(r.sending_month)} ·{" "}
                      <span className="font-mono">{r.ref_prefix}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {r.state !== "draft" && r.state !== "cancelled" && (
                      <div className="space-y-1">
                        <div className="text-muted-foreground flex justify-between text-xs">
                          <span>{t("Tracking numbers")}</span>
                          <span className="tabular-nums">
                            {c.registered}/{live}
                          </span>
                        </div>
                        <Progress value={live > 0 ? (c.registered / live) * 100 : 0} />
                      </div>
                    )}
                    <p className="text-sm">{nextStep(r.state, c, t)}</p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
