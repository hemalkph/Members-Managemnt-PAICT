import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangleIcon, ChevronLeftIcon, InfoIcon, ChevronRightIcon, PlugZapIcon, ReceiptTextIcon, SearchIcon, XIcon } from "lucide-react";
import { CitypakRunStatus } from "@/components/dispatch/citypak-run-status";
import { CitypakSyncButton } from "@/components/dispatch/citypak-sync-button";
import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isMissingCitypakTables, ORDER_MATCH } from "@/lib/citypak/labels";
import { MATCH_STATUSES, type MatchStatus } from "@/lib/citypak/orders";
import { chooseProvider } from "@/lib/citypak/provider";
import { loadRunStatus } from "@/lib/citypak/runs";
import { requireDispatch } from "@/lib/dispatch/access";
import { getT } from "@/lib/dispatch/i18n/server";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Orders & waybills – Citypak" };

const PER_PAGE = 25;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const isoDay = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : "");
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export default async function CitypakOrdersPage({ searchParams }: PageProps<"/admin/citypak/orders">) {
  const t = await getT();
  const { caps } = await requireDispatch(["courier", "plan"]);
  const canSync = caps.has("courier");
  const choice = chooseProvider();
  const sp = await searchParams;

  // Filters come from the URL. Search text goes into a PostgREST filter, so only
  // the characters identifiers use are kept.
  const q = one(sp.q).replace(/[^A-Za-z0-9-]/g, "").toUpperCase().slice(0, 40);
  const from = isoDay(one(sp.from));
  const to = isoDay(one(sp.to));
  const match = (MATCH_STATUSES as string[]).includes(one(sp.match)) ? (one(sp.match) as MatchStatus) : null;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(one(sp.page) || "1", 10) || 1));
  const filtered = Boolean(q || from || to || match);

  const href = (over: Record<string, string | number | null>) => {
    const params = new URLSearchParams();
    const merged = { q, from, to, match, page: 1, ...over };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "page" && v === 1)) params.set(k, String(v));
    const s = params.toString();
    return s ? `/admin/citypak/orders?${s}` : "/admin/citypak/orders";
  };

  const header = (actions?: React.ReactNode) => (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("Orders & waybills")}</h2>
        <p className="text-muted-foreground text-sm">
          {t("Orders created in Citypak, and whether each one matches a Tute dispatch parcel. Read-only.")}
        </p>
      </div>
      {actions}
    </div>
  );

  if (!choice.ok) {
    return (
      <div className="space-y-6">
        {header()}
        <EmptyState
          icon={PlugZapIcon}
          title={t("Citypak connection is not available yet")}
          description={
            choice.reason === "live_not_ready"
              ? t("Live access stays off until Citypak authorises it and the credentials are set on the server.")
              : t("The Citypak connection is switched off on this server.")
          }
        />
      </div>
    );
  }

  const { provider } = choice;
  const supabase = await createClient();
  const scoped = () =>
    supabase.from("citypak_order_matches").select("id", { count: "exact", head: true }).eq("account", provider.account).eq("mode", provider.mode);

  let query = supabase
    .from("citypak_order_matches")
    .select("id, external_id, tracking_no, reference, external_created_at, match_status", { count: "exact" })
    .eq("account", provider.account)
    .eq("mode", provider.mode);
  if (q) query = query.or(`tracking_no.ilike.*${q}*,reference.ilike.*${q}*`);
  if (from) query = query.gte("external_created_at", `${from}T00:00:00+05:30`);
  if (to) query = query.lt("external_created_at", `${nextDay(to)}T00:00:00+05:30`);
  if (match) query = query.eq("match_status", match);

  const [{ data: rows, count, error }, totals, { last, lastComplete }] = await Promise.all([
    query
      .order("external_created_at", { ascending: false, nullsFirst: false })
      .order("external_id", { ascending: false })
      .range((page - 1) * PER_PAGE, page * PER_PAGE - 1),
    // How many orders of each kind (all orders, not only the filtered ones).
    Promise.all([scoped(), ...MATCH_STATUSES.map((m) => scoped().eq("match_status", m))]),
    loadRunStatus(supabase, provider.account, "orders"),
  ]);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  // A page past the end (old link, fewer results now): PostgREST refuses the range (PGRST103) or returns nothing.
  if (page > 1 && (error?.code === "PGRST103" || (!error && page > pages))) redirect(href({ page: error ? 1 : pages }));
  if (error) console.error("citypak orders: load failed", { code: error.code });
  const list = rows ?? [];
  const [all, ...perStatus] = totals.map((r) => r.count ?? 0);

  // Nothing synced yet, or nothing matches the filters.
  const emptyState =
    all === 0 ? (
      <EmptyState
        icon={ReceiptTextIcon}
        title={t("No orders yet")}
        description={canSync ? t("Press Sync to fetch them.") : t("Someone with the Courier permission can sync them.")}
      />
    ) : (
      <EmptyState icon={SearchIcon} title={t("No orders match these filters")} description={t("Change the search or the dates.")} />
    );


  return (
    <div className="space-y-6">
      {header(canSync ? <CitypakSyncButton demo={provider.mode === "fixture"} list="orders" /> : undefined)}

      {error && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("Couldn't load the orders")}</AlertTitle>
          <AlertDescription>
            {isMissingCitypakTables(error)
              ? t("The Citypak order tables aren't in the database yet. An admin needs to apply migration 030.")
              : t("Reload the page. If it keeps happening, tell an admin.")}{" "}
            <span className="font-mono text-xs">({error.code})</span>
          </AlertDescription>
        </Alert>
      )}

      {provider.mode === "fixture" && (
        <Alert>
          <InfoIcon />
          <AlertTitle>{t("Demo data")}</AlertTitle>
          <AlertDescription>{t("Demo orders are never matched with real dispatch parcels.")}</AlertDescription>
        </Alert>
      )}

      <CitypakRunStatus
        t={t}
        last={last}
        lastComplete={lastComplete}
        savedNote="The orders it read are saved; sync again to complete the list."
      />

      {!error && all > 0 && (
        <nav aria-label={t("Filter by match")} className="flex flex-wrap gap-2">
          {[{ key: null, label: "All", n: all }, ...MATCH_STATUSES.map((m, i) => ({ key: m, label: ORDER_MATCH[m].label, n: perStatus[i] }))].map(
            (c) => (
              <Link
                key={c.key ?? "all"}
                href={href({ match: c.key })}
                aria-current={match === c.key ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring/50 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px]",
                  match === c.key ? "border-primary bg-primary/10 text-foreground font-medium" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t(c.label)}
                <span className="tabular-nums">{c.n}</span>
              </Link>
            ),
          )}
        </nav>
      )}

      {!error && all > 0 && (
        <form method="get" action="/admin/citypak/orders" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_160px_auto] sm:items-end">
          {match && <input type="hidden" name="match" value={match} />}
          <div className="grid gap-1.5">
            <Label htmlFor="orders-q">{t("Tracking number or reference")}</Label>
            <div className="relative">
              <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input id="orders-q" name="q" defaultValue={q} className="pl-9 font-mono" placeholder="D16950069" maxLength={40} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="orders-from">{t("From")}</Label>
            <Input id="orders-from" name="from" type="date" defaultValue={from} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="orders-to">{t("To")}</Label>
            <Input id="orders-to" name="to" type="date" defaultValue={to} />
          </div>
          <div className="flex gap-2">
            <Button type="submit">{t("Search")}</Button>
            {filtered && (
              <Button asChild variant="ghost">
                <Link href="/admin/citypak/orders">
                  <XIcon /> {t("Clear")}
                </Link>
              </Button>
            )}
          </div>
        </form>
      )}

      {!error && list.length === 0 ? (
        emptyState
      ) : (
        list.length > 0 && (
          <Card className="overflow-hidden py-0 shadow-xs">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-4">{t("Tracking number")}</TableHead>
                  <TableHead>{t("Reference")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("Created at Citypak")}</TableHead>
                  <TableHead className="pr-4 text-right">{t("Tute dispatch")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((o) => {
                  const m = ORDER_MATCH[o.match_status];
                  return (
                    <TableRow key={o.id} className="relative">
                      <TableCell className="py-3 pl-4">
                        <Link
                          href={`/admin/citypak/orders/${o.id}`}
                          className="font-mono text-sm font-medium underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:underline"
                        >
                          {o.tracking_no ?? `#${o.external_id}`}
                        </Link>
                        <p className="text-muted-foreground text-xs sm:hidden">
                          {o.external_created_at ? formatDateTime(o.external_created_at) : "—"}
                        </p>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{o.reference || "—"}</TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">
                        {o.external_created_at ? formatDateTime(o.external_created_at) : "—"}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Badge variant={m.variant} title={t(m.hint)}>
                          {t(m.label)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )
      )}

      {pages > 1 && (
        <nav aria-label={t("Pages")} className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm tabular-nums">
            {t("Page {page} of {pages} · {total} orders", { page, pages, total })}
          </p>
          <div className="flex gap-2">
            <Button asChild={page > 1} variant="outline" size="sm" disabled={page <= 1}>
              {page > 1 ? (
                <Link href={href({ page: page - 1 })}>
                  <ChevronLeftIcon /> {t("Previous")}
                </Link>
              ) : (
                <span>
                  <ChevronLeftIcon /> {t("Previous")}
                </span>
              )}
            </Button>
            <Button asChild={page < pages} variant="outline" size="sm" disabled={page >= pages}>
              {page < pages ? (
                <Link href={href({ page: page + 1 })}>
                  {t("Next")} <ChevronRightIcon />
                </Link>
              ) : (
                <span>
                  {t("Next")} <ChevronRightIcon />
                </span>
              )}
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
