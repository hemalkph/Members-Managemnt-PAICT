import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, FileIcon } from "lucide-react";
import { HandoverStation, StartHandover } from "@/components/dispatch/handover-station";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireDispatch } from "@/lib/dispatch/access";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

import { getT } from "@/lib/dispatch/i18n/server";
import { plural } from "@/lib/dispatch/i18n";
export const metadata: Metadata = { title: "Handover – Tute dispatch" };

export default async function HandoverPage({ params }: PageProps<"/admin/dispatch/rounds/[id]/handover">) {
  const t = await getT();
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  await requireDispatch("verify");
  const supabase = await createClient();
  const [{ data: round }, { data: settings }, { data: handovers }, { data: candidates }] = await Promise.all([
    supabase.from("dispatch_rounds").select("id, name, state").eq("id", id).maybeSingle(),
    supabase.from("dispatch_settings").select("require_verification").limit(1).maybeSingle(),
    supabase.rpc("dispatch_handover_list", { p_round: id }),
    supabase
      .from("parcels")
      .select("id, pack_state")
      .eq("round_id", id)
      .eq("registration_state", "registered")
      .eq("delivery_state", "awaiting_pickup")
      .eq("on_hold", false)
      .limit(20000),
  ]);
  if (!round) notFound();
  const verification = Boolean(settings?.require_verification);
  const open = (handovers ?? []).find((h) => h.state === "open") ?? null;
  // Parcels in a live handover of this round (open or confirmed) can't be scanned again.
  const { data: links } = await supabase
    .from("handover_parcels")
    .select("handover_id, parcel_id, parcels!inner(reference, round_id)")
    .eq("parcels.round_id", id)
    .is("released_at", null)
    .limit(20000);
  const live = new Set((links ?? []).map((l) => l.parcel_id));
  const ready = (candidates ?? []).filter(
    (p) => (verification ? p.pack_state === "verified" : p.pack_state !== "planned") && !live.has(p.id),
  ).length;
  const inOpen = (links ?? [])
    .filter((l) => open && l.handover_id === open.id)
    .map((l) => {
      const p = l.parcels as unknown as { reference: string };
      return { id: l.parcel_id, reference: p.reference };
    })
    .sort((a, b) => a.reference.localeCompare(b.reference));
  const past = (handovers ?? []).filter((h) => h.state !== "open");
  const roundOpen = round.state === "finalised" || round.state === "active";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Handover to Citypak")}
        description={`${round.name} · ${t("scan the parcels the courier takes, count them, confirm")}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/dispatch/rounds/${id}`}>
              <ArrowLeftIcon /> {t("Round")}
            </Link>
          </Button>
        }
      />
      {!roundOpen ? (
        <p className="text-muted-foreground text-sm">{t("This round is not open for handovers.")}</p>
      ) : open ? (
        <HandoverStation
          key={open.id}
          roundId={id}
          handoverId={open.id}
          initial={inOpen}
          ready={ready + inOpen.length}
        />
      ) : (
        <StartHandover roundId={id} ready={ready} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Earlier handovers")}</CardTitle>
        </CardHeader>
        <CardContent>
          {past.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("None yet.")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {past.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-col gap-1 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {h.state === "confirmed"
                        ? t(plural(h.parcels, "{n} parcel handed over", "{n} parcels handed over"), { n: h.parcels })
                        : t("Cancelled")}
                      {h.courier_rep && <span className="text-muted-foreground font-normal"> · {h.courier_rep}</span>}
                      {h.courier_ref && (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {t("ref {ref}", { ref: h.courier_ref })}
                        </span>
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {h.state === "confirmed"
                        ? t("{when} by {name}", {
                            when: formatDateTime(h.confirmed_at),
                            name: h.confirmed_name ?? t("someone"),
                          })
                        : `${formatDateTime(h.cancelled_at)}${h.cancel_reason ? ` – ${h.cancel_reason}` : ""}`}
                      {h.note && ` · ${h.note}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={h.state === "confirmed" ? "success" : "secondary"}>
                      {h.state === "confirmed" ? t("Confirmed") : t("Cancelled")}
                    </Badge>
                    {h.receipt_file && (
                      <Button asChild size="sm" variant="ghost">
                        <a href={`/admin/dispatch/files/${h.receipt_file}`} target="_blank" rel="noopener">
                          <FileIcon /> {t("Receipt")}
                        </a>
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
