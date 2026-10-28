import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  CheckCheckIcon,
  FileTextIcon,
  GaugeIcon,
  PartyPopperIcon,
  SparklesIcon,
  TimerIcon,
  TriangleAlertIcon,
} from "lucide-react";
import BlurText from "@/components/reactbits/blur-text";
import ShinyText from "@/components/reactbits/shiny-text";
import { StatCard } from "@/components/stat-card";
import { MonthBars } from "@/components/team/month-bars";
import { StageSpeed } from "@/components/team/stage-speed";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireCompleteProfile } from "@/lib/auth";
import { monthLabel } from "@/lib/month";
import { getTeamPerformance } from "@/lib/performance";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My performance" };

const PERIODS = [1, 3, 6] as const;

/** A friendly line for the member, based on their numbers. */
function cheer(rate: number | null, done: number, overdue: number): { text: string; icon: typeof SparklesIcon } {
  if (overdue > 0)
    return {
      text: `Finish your ${overdue} overdue task${overdue === 1 ? "" : "s"} to lift your on-time rate.`,
      icon: TriangleAlertIcon,
    };
  if (done === 0) return { text: "Finish your first task to start your record.", icon: SparklesIcon };
  if (rate === null)
    return { text: "Nice work! Tasks with a due date count towards your on-time rate.", icon: SparklesIcon };
  if (rate >= 90) return { text: "Excellent – you're finishing almost everything on time!", icon: PartyPopperIcon };
  if (rate >= 70) return { text: "Good work. A few more on time and you'll be at the top.", icon: SparklesIcon };
  return { text: "Try starting a day earlier – the work days are on My week.", icon: SparklesIcon };
}

export default async function MyPerformancePage({ searchParams }: PageProps<"/performance">) {
  const profile = await requireCompleteProfile();
  const raw = Number((await searchParams).months);
  const months = PERIODS.find((p) => p === raw) ?? 3;

  const supabase = await createClient();
  const perf = await getTeamPerformance(supabase, months, profile.id);
  const me = perf.members[0];
  const period =
    months === 1
      ? monthLabel(perf.months[0])
      : `${monthLabel(perf.months[0], "short")} – ${monthLabel(perf.months.at(-1)!, "short")}`;
  const line = cheer(me?.onTimeRate ?? null, me?.done ?? 0, me?.overdueNow ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <BlurText as="h1" text="My performance" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
          <p className="text-muted-foreground text-sm">Your tasks and paper stages · {period}</p>
        </div>
        <Tabs value={String(months)}>
          <TabsList>
            {PERIODS.map((p) => (
              <TabsTrigger key={p} value={String(p)} asChild>
                <Link href={`/performance?months=${p}`}>{p === 1 ? "This month" : `${p} months`}</Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="from-primary/10 to-chart-2/10 flex items-center gap-3 rounded-xl border bg-gradient-to-r p-4">
        <line.icon className="text-primary size-5 shrink-0" />
        <ShinyText text={line.text} className="text-sm font-medium" />
        {(me?.overdueNow ?? 0) > 0 && (
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <Link href="/tasks">
              My tasks <ArrowRightIcon />
            </Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Tasks done" value={me?.done ?? 0} icon={CheckCheckIcon} tone="success" hint={period} />
        <StatCard
          label="Done on time"
          value={me?.onTimeRate ?? 0}
          suffix="%"
          icon={GaugeIcon}
          hint={me?.withDue ? `${me.onTime} of ${me.withDue} with a due date` : "No due dates yet"}
          delay={0.1}
        />
        <StatCard
          label="Average time per task"
          value={me?.avgDays ?? 0}
          decimals={1}
          suffix=" days"
          icon={TimerIcon}
          tone="info"
          hint="from start to done"
          delay={0.2}
        />
        <StatCard
          label="Pages"
          value={me?.pages ?? 0}
          icon={FileTextIcon}
          tone="warning"
          hint="approved type setting / conversion"
          delay={0.3}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>My pages per month</CardTitle>
            <CardDescription>Approved pages you type set or converted</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthBars
              label="Pages"
              data={perf.pagesByMonth.map((p) => ({ label: monthLabel(p.month, "short"), value: p.pages }))}
            />
          </CardContent>
        </Card>
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>My paper stages</CardTitle>
            <CardDescription>Average days you took. The line marks the planned work days.</CardDescription>
          </CardHeader>
          <CardContent>
            <StageSpeed stages={perf.stages} empty="You haven't finished a paper stage in this period." />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
