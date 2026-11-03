import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, InfoIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CONFLICT_REASON, ORDER_MATCH } from "@/lib/citypak/labels";
import { requireDispatch } from "@/lib/dispatch/access";
import { DELIVERY, type DeliveryState } from "@/lib/dispatch/delivery";
import { getT } from "@/lib/dispatch/i18n/server";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Citypak order – Citypak" };

const PACK_LABEL: Record<string, string> = { planned: "Not packed yet", packed: "Packed", verified: "Verified" };

export default async function CitypakOrderPage({ params }: PageProps<"/admin/citypak/orders/[id]">) {
  const t = await getT();
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  await requireDispatch(["courier", "plan"]);
  const supabase = await createClient();
  const { data: o, error } = await supabase.from("citypak_order_matches").select("*").eq("id", id).maybeSingle();
  // A load error is not "not found": surface it (code only, no data).
  if (error) throw new Error(`Citypak order could not be loaded (${error.code})`);
  if (!o) notFound();

  // The dispatch parcels its identifiers point to (one, two in a conflict, or none). Read-only.
  const parcelIds = [...new Set([o.tracking_parcel_id, o.reference_parcel_id].filter((x): x is string => Boolean(x)))];
  const [{ data: parcels }, { data: history }] = await Promise.all([
    parcelIds.length
      ? supabase
          .from("parcels")
          .select("id, reference, tracking_no, registration_state, pack_state, delivery_state, round_id")
          .in("id", parcelIds)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("citypak_order_history")
      .select("id, kind, tracking_no, prev_tracking_no, reference, prev_reference, created_at")
      .eq("order_id", o.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const roundIds = [...new Set((parcels ?? []).map((p) => p.round_id))];
  const { data: rounds } = roundIds.length
    ? await supabase.from("dispatch_rounds").select("id, name").in("id", roundIds)
    : { data: [] as { id: string; name: string }[] };
  const roundName = new Map((rounds ?? []).map((r) => [r.id, r.name]));

  const m = ORDER_MATCH[o.match_status];
  const when = (v: string | null) => (v ? formatDateTime(v) : "—");
  const facts: [string, React.ReactNode][] = [
    [t("Tracking number"), <span key="t" className="font-mono">{o.tracking_no ?? "—"}</span>],
    [t("Reference"), <span key="r" className="font-mono">{o.reference || "—"}</span>],
    [t("Citypak order ID"), <span key="i" className="font-mono">{o.external_id}</span>],
    [t("Created at Citypak"), when(o.external_created_at)],
    [
      t("Courier status"),
      <span key="s" className="text-muted-foreground">
        {t("Not available yet – Citypak's status values haven't been confirmed.")}
      </span>,
    ],
    [t("First synced"), when(o.first_seen_at)],
    [t("Last seen in a sync"), when(o.last_seen_at)],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="font-mono text-xl font-semibold tracking-tight">{o.tracking_no ?? `#${o.external_id}`}</h2>}
        description={t("Citypak order")}
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/citypak/orders">
              <ArrowLeftIcon /> {t("All orders")}
            </Link>
          </Button>
        }
      />

      {o.mode === "fixture" && (
        <Alert>
          <InfoIcon />
          <AlertTitle>{t("Demo data")}</AlertTitle>
          <AlertDescription>
            {t("This order is made-up fixture data, not from Citypak.")} {t("Demo orders are never matched with real dispatch parcels.")}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card className="py-0 shadow-xs">
            <dl className="divide-y">
              {facts.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-3 px-4 py-3 text-sm">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="gap-3 shadow-xs">
            <CardHeader>
              <CardTitle className="text-base">{t("History")}</CardTitle>
              <CardDescription>{t("When this order first appeared, and changes to its identifiers.")}</CardDescription>
            </CardHeader>
            <CardContent>
              {history && history.length > 0 ? (
                <ol className="space-y-2 text-sm">
                  {history.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-muted-foreground tabular-nums">{formatDateTime(h.created_at)}</span>
                      {h.kind === "first_seen" ? (
                        <span>{t("First seen in a sync")}</span>
                      ) : (
                        <span>
                          {h.prev_tracking_no !== h.tracking_no &&
                            t("Tracking number {from} → {to}", { from: h.prev_tracking_no ?? "—", to: h.tracking_no ?? "—" })}{" "}
                          {h.prev_reference !== h.reference &&
                            t("Reference {from} → {to}", { from: h.prev_reference || "—", to: h.reference || "—" })}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted-foreground text-sm">{t("Nothing yet.")}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="gap-3 shadow-xs">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              {t("Tute dispatch")}
              <Badge variant={m.variant}>{t(m.label)}</Badge>
            </CardTitle>
            <CardDescription>{t(m.hint)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {o.conflict_reason && (
              <Alert variant="destructive">
                <AlertTitle>{t("Why it's a conflict")}</AlertTitle>
                <AlertDescription>{t(CONFLICT_REASON[o.conflict_reason] ?? "Its identifiers disagree with Tute dispatch.")}</AlertDescription>
              </Alert>
            )}
            {(parcels ?? []).map((p) => {
              const by = [
                p.id === o.tracking_parcel_id ? t("tracking number") : null,
                p.id === o.reference_parcel_id ? t("reference") : null,
              ]
                .filter(Boolean)
                .join(" + ");
              return (
                <div key={p.id} className="space-y-1.5 rounded-lg border p-3 text-sm">
                  <p className="text-muted-foreground text-xs">{t("Found by {by}", { by })}</p>
                  <p className="font-mono font-medium">{p.reference}</p>
                  <p className="text-muted-foreground font-mono text-xs">{p.tracking_no ?? t("No tracking number in Tute dispatch")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.registration_state === "voided" && <Badge variant="secondary">{t("Voided")}</Badge>}
                    <Badge variant="outline">{t(PACK_LABEL[p.pack_state] ?? p.pack_state)}</Badge>
                    <Badge variant={DELIVERY[p.delivery_state as DeliveryState]?.variant ?? "outline"}>
                      {t(DELIVERY[p.delivery_state as DeliveryState]?.label ?? p.delivery_state)}
                    </Badge>
                  </div>
                  <Link href={`/admin/dispatch/rounds/${p.round_id}`} className="text-primary text-xs font-medium underline-offset-4 hover:underline">
                    {roundName.get(p.round_id) ?? t("Open round")}
                  </Link>
                </div>
              );
            })}
            <p className="text-muted-foreground text-xs">
              {t("Matching uses only the tracking number and the reference, never names, phones or addresses. Nothing in Tute dispatch is changed from here.")}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
