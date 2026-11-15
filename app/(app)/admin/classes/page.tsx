import type { Metadata } from "next";
import { ClassesManager } from "@/components/classes/classes-manager";
import BlurText from "@/components/reactbits/blur-text";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { Sticker } from "@/components/sticker";
import { requirePage } from "@/lib/auth";
import { getClassOptions } from "@/lib/organisation/classes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Batches & exams" };

export default async function ClassesPage() {
  const { canEdit } = await requirePage("classes");
  const supabase = await createClient();
  const [options, { data: tagged }, { data: partRows }] = await Promise.all([
    getClassOptions(supabase),
    supabase.from("submissions").select("exam_id, centre_id").or("exam_id.not.is.null,centre_id.not.is.null").limit(5000),
    supabase.from("exam_parts").select("exam_id, name, max_marks, sort_order").order("sort_order").limit(5000),
  ]);

  // "MCQ /50 · SE & Essay /100" for each exam.
  const parts: Record<string, string> = {};
  for (const p of partRows ?? []) {
    const label = `${p.name} /${Number(p.max_marks)}`;
    parts[p.exam_id] = parts[p.exam_id] ? `${parts[p.exam_id]} · ${label}` : label;
  }

  // How much work is tagged with each exam / centre.
  const counts: Record<string, number> = {};
  for (const row of tagged ?? []) {
    if (row.exam_id) counts[row.exam_id] = (counts[row.exam_id] ?? 0) + 1;
    if (row.centre_id) counts[row.centre_id] = (counts[row.centre_id] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Sticker name="study" size={64} loop />
        <div className="space-y-1">
          <BlurText as="h1" text="Batches & exams" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
          <p className="text-muted-foreground text-sm">
            A/L batches, their exam series (e.g. Ranking Full Papers → RFP 01, 02, …) and class centres. Members tag their work with them, and tasks and papers are
            grouped by exam.
          </p>
        </div>
      </div>
      {!canEdit && <ReadOnlyNotice />}
      <ClassesManager options={options} counts={counts} parts={parts} readOnly={!canEdit} />
    </div>
  );
}
