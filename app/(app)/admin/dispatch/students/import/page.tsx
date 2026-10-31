import type { Metadata } from "next";
import { ImportWizard } from "@/components/dispatch/import-wizard";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { GraduationCapIcon } from "lucide-react";
import { requireDispatch } from "@/lib/dispatch/access";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Import students – Tute dispatch" };

export default async function ImportStudentsPage() {
  await requireDispatch("plan");
  const supabase = await createClient();
  const { data } = await supabase.from("batches").select("id, name").eq("is_active", true).order("sort_order").order("name");
  const batches = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import students"
        description="Upload → match columns → check → preview → confirm. Only the rows you tick are saved."
      />
      {batches.length === 0 ? (
        <EmptyState icon={GraduationCapIcon} title="Add a batch first" description="Students belong to a batch. Add one under Batches & exams." />
      ) : (
        <ImportWizard batches={batches} />
      )}
    </div>
  );
}
