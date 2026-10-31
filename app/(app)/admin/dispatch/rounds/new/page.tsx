import type { Metadata } from "next";
import { GraduationCapIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RoundForm } from "@/components/dispatch/round-form";
import { Card, CardContent } from "@/components/ui/card";
import { requireDispatch } from "@/lib/dispatch/access";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New round – Tute dispatch" };

export default async function NewRoundPage() {
  await requireDispatch("plan");
  const supabase = await createClient();
  const [{ data: batches }, { data: settings }] = await Promise.all([
    supabase.from("batches").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("dispatch_settings").select("default_cod, default_weight_g, default_pieces").limit(1).maybeSingle(),
  ]);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <PageHeader title="New dispatch round" description="Step 1 of 5: round details. Next you choose tutes, students and what each parcel holds." />
      {!batches || batches.length === 0 ? (
        <EmptyState icon={GraduationCapIcon} title="Add a batch first" description="Rounds belong to a batch. Add one under Batches & exams." />
      ) : (
        <Card>
          <CardContent>
            <RoundForm
              batches={batches}
              values={{
                id: "",
                name: "",
                batch_id: batches[0].id,
                sending_month: month,
                group_label: "",
                subject: "",
                ref_prefix: "",
                default_cod: Number(settings?.default_cod ?? 0),
                default_weight_g: settings?.default_weight_g ?? 1000,
                default_pieces: settings?.default_pieces ?? 1,
                planned_handover: "",
                notes: "",
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
