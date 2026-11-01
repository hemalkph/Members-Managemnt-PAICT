import type { Metadata } from "next";
import Link from "next/link";
import { PackageIcon, PlusIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireDispatch } from "@/lib/dispatch/access";
import { loadRoundProgress } from "@/lib/dispatch/round-progress";
import { monthLabelFromDate, ROUND_STATE } from "@/lib/dispatch/rounds";
import { roundStages } from "@/lib/dispatch/stages";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { getT } from "@/lib/dispatch/i18n/server";
export const metadata: Metadata = { title: "Rounds – Tute dispatch" };

const FILTERS = [
  { key: "open", label: "In progress", states: ["draft", "finalised", "active"] },
  { key: "closed", label: "Closed", states: ["closed", "cancelled"] },
  { key: "all", label: "All", states: ["draft", "finalised", "active", "closed", "cancelled"] },
] as const;

export default async function RoundsPage({ searchParams }: PageProps<"/admin/dispatch/rounds">) {
  const t = await getT();
  const { caps } = await requireDispatch();
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.show) ?? FILTERS[0];
  const supabase = await createClient();
  const [{ data: rounds }, { data: batches }] = await Promise.all([
    supabase
      .from("dispatch_rounds")
      .select("id, name, batch_id, sending_month, state, ref_prefix, created_at")
      .in("state", [...filter.states])
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("batches").select("id, name"),
  ]);
  const list = rounds ?? [];
  const progress = new Map(
    (await loadRoundProgress(supabase, list.map((r) => r.id))).map((r) => [r.id, r.progress]),
  );
  const batchName = new Map((batches ?? []).map((b) => [b.id, b.name]));

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

      <nav aria-label={t("Show rounds")} className="bg-muted inline-flex rounded-lg p-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "open" ? "/admin/dispatch/rounds" : `/admin/dispatch/rounds?show=${f.key}`}
            aria-current={f.key === filter.key ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
              f.key === filter.key
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(f.label)}
          </Link>
        ))}
      </nav>

      {list.length === 0 ? (
        <EmptyState
          icon={PackageIcon}
          title={t("No rounds yet")}
          description={t("Create a round to plan which tutes go to which students.")}
        />
      ) : (
        <Card className="overflow-hidden py-0 shadow-xs">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">{t("Round")}</TableHead>
                <TableHead className="hidden w-[38%] md:table-cell">{t("Steps")}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{t("Parcels")}</TableHead>
                <TableHead className="pr-4 text-right">{t("Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => {
                const p = progress.get(r.id);
                const stages = p ? roundStages(r.id, p, caps) : [];
                const now = stages.find((s) => s.status === "now");
                return (
                  <TableRow key={r.id} className="group relative">
                    <TableCell className="py-3 pl-4">
                      {/* The whole row opens the round; the link covers it. */}
                      <Link
                        href={`/admin/dispatch/rounds/${r.id}`}
                        className="font-medium underline-offset-4 outline-none group-hover:underline after:absolute after:inset-0 focus-visible:underline"
                      >
                        {r.name}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {batchName.get(r.batch_id) ?? "—"} · {monthLabelFromDate(r.sending_month)} ·{" "}
                        <span className="font-mono">{r.ref_prefix}</span>
                      </p>
                      {now && (
                        <p className="text-primary mt-1 text-xs font-medium md:hidden">
                          {t(now.label)}
                          {now.count && <span className="text-muted-foreground tabular-nums"> · {now.count}</span>}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {r.state !== "cancelled" && stages.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex gap-1" aria-hidden>
                            {stages.map((s) => (
                              <span key={s.key} className="bg-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
                                <span
                                  className={cn(
                                    "absolute inset-y-0 left-0 rounded-full",
                                    s.status === "done" ? "bg-success" : "bg-primary",
                                  )}
                                  style={{ width: `${s.share * 100}%` }}
                                />
                              </span>
                            ))}
                          </div>
                          <p className="text-xs">
                            {now ? (
                              <>
                                <span className="font-medium">{t(now.label)}</span>
                                {now.count && <span className="text-muted-foreground tabular-nums"> · {now.count}</span>}
                              </>
                            ) : (
                              <span className="text-muted-foreground">{t("All steps done")}</span>
                            )}
                          </p>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {p?.live ?? 0}
                      {p && p.onHold > 0 && (
                        <span className="block text-xs text-amber-700 dark:text-warning">
                          {t("{n} on hold", { n: p.onHold })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Badge variant={ROUND_STATE[r.state].variant}>{t(ROUND_STATE[r.state].label)}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
