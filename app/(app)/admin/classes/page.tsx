import type { Metadata } from "next";
import { ClassesManager } from "@/components/classes/classes-manager";
import BlurText from "@/components/reactbits/blur-text";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { requirePage } from "@/lib/auth";
import { getClassOptions } from "@/lib/classes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Batches & exams" };

export default async function ClassesPage() {
  const { canEdit } = await requirePage("classes");
  const supabase = await createClient();
  const [options, { data: tagged }] = await Promise.all([
    getClassOptions(supabase),
    supabase.from("submissions").select("exam_id, centre_id").or("exam_id.not.is.null,centre_id.not.is.null").limit(5000),
  ]);

  // How much work is tagged with each exam / centre.
  const counts: Record<string, number> = {};
  for (const row of tagged ?? []) {
    if (row.exam_id) counts[row.exam_id] = (counts[row.exam_id] ?? 0) + 1;
    if (row.centre_id) counts[row.centre_id] = (counts[row.centre_id] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <BlurText as="h1" text="Batches & exams" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
        <p className="text-muted-foreground text-sm">
          A/L batches, their tests and class centres. Members tag their work with them, and tasks and papers are grouped
          by exam.
        </p>
      </div>
      {!canEdit && <ReadOnlyNotice />}
      <ClassesManager options={options} counts={counts} readOnly={!canEdit} />
    </div>
  );
}
