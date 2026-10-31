import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { DeliveryBoard } from "@/components/dispatch/delivery-board";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireDispatch } from "@/lib/dispatch/access";
import type { DeliveryState } from "@/lib/dispatch/delivery";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

import { getT } from "@/lib/dispatch/i18n/server";
export const metadata: Metadata = { title: "Delivery – Tute dispatch" };

export default async function DeliveryPage({ params }: PageProps<"/admin/dispatch/rounds/[id]/delivery">) {
  const t = await getT();
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { caps } = await requireDispatch("courier");
  const supabase = await createClient();
  const [{ data: round }, { data: parcels }, { data: tutes }, { data: openLinks }] = await Promise.all([
    supabase.from("dispatch_rounds").select("id, name, state").eq("id", id).maybeSingle(),
    supabase
      .from("parcels")
      .select(
        "id, reference, tracking_no, cod_expected, delivery_state, registration_state, replaces_parcel_id, delivery_note, students!inner(student_no), parcel_recipients(name, address_line1, address_line2, address_line3, city, phone1, phone2), parcel_items(round_tute_id)",
      )
      .eq("round_id", id)
      .order("reference")
      .limit(20000),
    supabase.from("round_tutes").select("id, short_code, title").eq("round_id", id).order("sort_order"),
    supabase
      .from("handover_parcels")
      .select("parcel_id, handovers!inner(state, round_id)")
      .eq("handovers.round_id", id)
      .eq("handovers.state", "open")
      .is("released_at", null),
  ]);
  if (!round) notFound();
  const inOpen = new Set((openLinks ?? []).map((l) => l.parcel_id));
  const replaced = new Set((parcels ?? []).map((p) => p.replaces_parcel_id).filter(Boolean));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Delivery")}
        description={`${round.name} · ${t("update what Citypak reports, handle returns, send parcels again")}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/dispatch/rounds/${id}`}>
              <ArrowLeftIcon /> {t("Round")}
            </Link>
          </Button>
        }
      />
      <p className="text-muted-foreground text-sm">
        {t(
          "Set statuses from the Citypak portal or the rider. Importing Citypak's status report will come once we have a real sample file.",
        )}
      </p>
      <DeliveryBoard
        roundId={id}
        canSet={caps.has("courier")}
        canCorrect={caps.has("correct")}
        tutes={(tutes ?? []).map((tute) => ({ id: tute.id, code: tute.short_code, title: tute.title }))}
        rows={(parcels ?? []).map((p) => {
          const r = (Array.isArray(p.parcel_recipients) ? p.parcel_recipients[0] : p.parcel_recipients) as
            | {
                name: string;
                address_line1: string;
                address_line2: string;
                address_line3: string;
                city: string;
                phone1: string | null;
                phone2: string | null;
              }
            | null
            | undefined;
          return {
            id: p.id,
            reference: p.reference,
            trackingNo: p.tracking_no,
            studentNo: (p.students as unknown as { student_no: string }).student_no,
            recipient: {
              name: r?.name ?? "",
              address_line1: r?.address_line1 ?? "",
              address_line2: r?.address_line2 ?? "",
              address_line3: r?.address_line3 ?? "",
              city: r?.city ?? "",
              phone1: r?.phone1 ?? "",
              phone2: r?.phone2 ?? "",
            },
            cod: Number(p.cod_expected),
            deliveryState: p.delivery_state as DeliveryState,
            registrationState: p.registration_state,
            inOpenHandover: inOpen.has(p.id),
            replaced: replaced.has(p.id),
            itemIds: (p.parcel_items as unknown as { round_tute_id: string }[]).map((i) => i.round_tute_id),
            note: p.delivery_note,
          };
        })}
      />
    </div>
  );
}
