import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, ArrowLeftIcon, CalendarCheckIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { CountdownList } from "@/components/papers/countdown-list";
import { StageTimingCard } from "@/components/papers/stage-timing-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth";
import { todayISO } from "@/lib/core/month";
import { getCountdownPage } from "@/lib/papers/countdown-queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Exam countdown" };

export default async function ExamCountdownPage() {
  const { profile } = await requirePage("papers");
  const today = todayISO();
  const supabase = await createClient();
  const data = await getCountdownPage(supabase, today);
  const late = data.rows.filter((r) => r.state === "late").length;
  const atRisk = data.rows.filter((r) => r.state === "at_risk").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exam countdown"
        description={
          data.error
            ? "Every paper with an exam in the next six weeks."
            : `Every paper with an exam in the next six weeks: ${late} late, ${atRisk} at risk.`
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/papers">
              <ArrowLeftIcon /> Papers
            </Link>
          </Button>
        }
      />
      {data.error ? (
        <EmptyState icon={AlertTriangleIcon} title="Couldn't load the countdown" description={data.error} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
          <div className="min-w-0">
            {data.rows.length === 0 ? (
              <EmptyState
                icon={CalendarCheckIcon}
                title="No exams in the next six weeks"
                description="Papers show here once they have an exam day."
              />
            ) : (
              <CountdownList rows={data.rows} today={today} whatsapp={data.whatsapp} />
            )}
          </div>
          <StageTimingCard stats={data.stats} suggestions={data.suggestions} canApply={profile.is_admin} />
        </div>
      )}
    </div>
  );
}
