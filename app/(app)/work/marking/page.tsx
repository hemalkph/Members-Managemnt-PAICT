import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardPenIcon, UserRoundXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { MarkingForm, type MarkingPaper } from "@/components/member/marking-form";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompleteProfile } from "@/lib/auth";
import { formatDate, formatDay, formatNumber } from "@/lib/format";
import { getMarkingRates, markingParts } from "@/lib/marking";
import { addDays, PART_LABEL } from "@/lib/papers";
import { todayISO } from "@/lib/month";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Log marking" };

/** Marking team: how many MCQ / Essay papers were marked at each centre. */
export default async function MarkingPage() {
  const profile = await requireCompleteProfile();
  const supabase = await createClient();

  const rates = await getMarkingRates(supabase, profile.id);
  const rateIds = [rates.mcq?.rateItemId, rates.essay?.rateItemId].filter((x): x is string => Boolean(x));
  const [{ data: paperRows }, { data: centres }, { data: recent }] = await Promise.all([
    supabase
      .from("papers")
      .select("id, title, part, exam_day, handed_over_at")
      .eq("kind", "paper")
      .neq("status", "cancelled")
      .gte("exam_day", addDays(todayISO(), -120))
      .order("exam_day", { ascending: false })
      .limit(100),
    supabase.from("centres").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    rateIds.length
      ? supabase
          .from("submissions")
          .select("id, title, quantity, status, created_at")
          .eq("user_id", profile.id)
          .in("rate_item_id", rateIds)
          .order("created_at", { ascending: false })
          .limit(15)
      : Promise.resolve({
          data: [] as { id: string; title: string; quantity: number; status: "pending"; created_at: string }[],
        }),
  ]);

  // Papers that were handed over (or whose exam day is here).
  const today = todayISO();
  const papers: MarkingPaper[] = (paperRows ?? [])
    .filter((p) => p.handed_over_at || (p.exam_day && p.exam_day <= today))
    .map((p) => ({
      id: p.id,
      title: p.title,
      sub: `${PART_LABEL[p.part]}${p.exam_day ? ` · ${formatDay(p.exam_day)}` : ""}`,
      parts: markingParts(p.part),
    }));

  const noRates = !rates.mcq && !rates.essay;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Log marking"
        description="Enter how many papers you marked at each centre. You're paid per marked MCQ and Essay paper."
        actions={
          <Button asChild variant="outline">
            <Link href="/work/new">Other work</Link>
          </Button>
        }
      />

      {noRates ? (
        <EmptyState
          icon={UserRoundXIcon}
          title="No marking rate yet"
          description='An admin needs to give your role the "MCQ paper marking" and "Essay paper marking" rates.'
        />
      ) : papers.length === 0 ? (
        <EmptyState
          icon={ClipboardPenIcon}
          title="No papers to mark yet"
          description="Papers show here once they are handed over."
        />
      ) : (
        <Card>
          <CardContent>
            <MarkingForm
              papers={papers}
              centres={centres ?? []}
              canMcq={Boolean(rates.mcq)}
              canEssay={Boolean(rates.essay)}
            />
          </CardContent>
        </Card>
      )}

      {(recent ?? []).length > 0 && (
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Your recent marking</CardTitle>
            <CardDescription>Check here before sending, so nothing is logged twice.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {(recent ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatNumber(s.quantity)} papers · {formatDate(s.created_at)}
                  </p>
                </div>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
