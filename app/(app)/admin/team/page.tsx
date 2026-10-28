import type { Metadata } from "next";
import Link from "next/link";
import {
  AlarmClockIcon,
  CheckCheckIcon,
  FileTextIcon,
  GaugeIcon,
  RabbitIcon,
  TimerIcon,
  TrophyIcon,
  TriangleAlertIcon,
} from "lucide-react";
import BlurText from "@/components/reactbits/blur-text";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { StatCard } from "@/components/stat-card";
import { PagesChart } from "@/components/team/pages-chart";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAdmin } from "@/lib/auth";
import { monthLabel } from "@/lib/month";
import { getTeamPerformance, MIN_FOR_RANKING, type MemberPerformance } from "@/lib/performance";
import { signedAvatarUrls } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Team performance" };

const PERIODS = [1, 3, 6] as const;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

const days = (n: number | null) => (n === null ? "—" : `${n} day${n === 1 ? "" : "s"}`);

function Person({ m, avatar, size = "size-8" }: { m: MemberPerformance; avatar?: string; size?: string }) {
  return (
    <Avatar className={size}>
      {avatar && <AvatarImage src={avatar} alt="" />}
      <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials(m.name)}</AvatarFallback>
    </Avatar>
  );
}

export default async function TeamPerformancePage({ searchParams }: PageProps<"/admin/team">) {
  await requireAdmin();
  const raw = Number((await searchParams).months);
  const months = PERIODS.find((p) => p === raw) ?? 3;

  const supabase = await createClient();
  const perf = await getTeamPerformance(supabase, months);
  const avatars = await signedAvatarUrls(
    supabase,
    perf.members.map((m) => m.avatarPath),
  );
  const avatarOf = (m: MemberPerformance) => (m.avatarPath ? avatars.get(m.avatarPath) : undefined);
  const period =
    months === 1
      ? monthLabel(perf.months[0])
      : `${monthLabel(perf.months[0], "short")} – ${monthLabel(perf.months.at(-1)!, "short")}`;

  // Recognition (only people with enough tasks to be fair).
  const ranked = perf.members.filter((m) => m.withDue >= MIN_FOR_RANKING && m.onTimeRate !== null);
  const mostOnTime = [...ranked].sort((a, b) => b.onTimeRate! - a.onTimeRate! || b.withDue - a.withDue)[0];
  const mostPages = [...perf.members].filter((m) => m.pages > 0).sort((a, b) => b.pages - a.pages)[0];
  const quickest = [...perf.members]
    .filter((m) => m.done >= MIN_FOR_RANKING && m.avgDays !== null)
    .sort((a, b) => a.avgDays! - b.avgDays!)[0];
  const awards = [
    mostOnTime && {
      icon: AlarmClockIcon,
      title: "Most on time",
      m: mostOnTime,
      value: `${mostOnTime.onTimeRate}% on time`,
    },
    mostPages && { icon: FileTextIcon, title: "Most pages", m: mostPages, value: `${mostPages.pages} pages` },
    quickest && { icon: RabbitIcon, title: "Quickest", m: quickest, value: `${days(quickest.avgDays)} per task` },
  ].filter(Boolean) as { icon: typeof TrophyIcon; title: string; m: MemberPerformance; value: string }[];

  const stageRows = perf.stages.filter((s) => s.done > 0);
  const maxDays = Math.max(1, ...stageRows.map((s) => Math.max(s.avgDays ?? 0, s.plannedDays ?? 0)));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <BlurText as="h1" text="Team performance" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
          <p className="text-muted-foreground text-sm">
            Tasks and paper stages finished on time, how long they took, and approved pages · {period}
          </p>
        </div>
        <Tabs value={String(months)}>
          <TabsList>
            {PERIODS.map((p) => (
              <TabsTrigger key={p} value={String(p)} asChild>
                <Link href={`/admin/team?months=${p}`}>{p === 1 ? "This month" : `${p} months`}</Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Tasks done" value={perf.team.done} icon={CheckCheckIcon} tone="success" hint={period} />
        <StatCard
          label="Done on time"
          value={perf.team.onTimeRate ?? 0}
          suffix="%"
          icon={GaugeIcon}
          hint={perf.team.onTimeRate === null ? "No due dates yet" : "of tasks with a due date"}
          delay={0.1}
        />
        <StatCard
          label="Average time per task"
          value={perf.team.avgDays ?? 0}
          decimals={1}
          suffix=" days"
          icon={TimerIcon}
          tone="info"
          hint="from start to done"
          delay={0.2}
        />
        <StatCard
          label="Overdue right now"
          value={perf.team.overdueNow}
          icon={TriangleAlertIcon}
          tone="warning"
          hint="open tasks past their due date"
          delay={0.3}
        />
      </div>

      {awards.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {awards.map((a) => (
            <SpotlightCard
              key={a.title}
              className="from-primary/10 flex items-center gap-3 bg-gradient-to-br to-transparent p-4"
            >
              <div className="relative">
                <Person m={a.m} avatar={avatarOf(a.m)} size="size-11" />
                <span className="bg-primary text-primary-foreground absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full ring-2 ring-[var(--card)]">
                  <a.icon className="size-3" />
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground flex items-center gap-1 text-xs font-medium">
                  <TrophyIcon className="size-3" /> {a.title}
                </p>
                <p className="truncate font-semibold">{a.m.name}</p>
                <p className="text-muted-foreground text-sm">{a.value}</p>
              </div>
            </SpotlightCard>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Pages per month</CardTitle>
            <CardDescription>Approved type setting and conversion pages · {perf.team.pages} in total</CardDescription>
          </CardHeader>
          <CardContent>
            <PagesChart
              data={perf.pagesByMonth.map((p) => ({ label: monthLabel(p.month, "short"), pages: p.pages }))}
            />
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Paper stages: actual vs planned days</CardTitle>
            <CardDescription>Average days each stage took. The line marks the planned work days.</CardDescription>
          </CardHeader>
          <CardContent>
            {stageRows.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">No paper stages finished in this period.</p>
            ) : (
              <ul className="space-y-3">
                {stageRows.map((s) => {
                  const late = s.avgDays !== null && s.plannedDays !== null && s.avgDays > s.plannedDays;
                  return (
                    <li
                      key={s.stage}
                      className="space-y-1"
                      title={`${s.label}: ${days(s.avgDays)} on average (planned ${days(s.plannedDays)}) · ${s.done} done${s.onTimeRate !== null ? ` · ${s.onTimeRate}% on time` : ""}`}
                    >
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{s.label}</span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          <span className={cn("text-foreground font-semibold", late && "text-destructive")}>
                            {days(s.avgDays)}
                          </span>
                          {s.plannedDays !== null && ` / ${days(s.plannedDays)} planned`}
                          {late && (
                            <TriangleAlertIcon
                              className="text-destructive ml-1 inline size-3.5"
                              aria-label="slower than planned"
                            />
                          )}
                        </span>
                      </div>
                      <div className="bg-muted relative h-2.5 rounded-full">
                        <div
                          className={cn("h-full rounded-full", late ? "bg-destructive" : "bg-primary")}
                          style={{ width: `${Math.max(2, ((s.avgDays ?? 0) / maxDays) * 100)}%` }}
                        />
                        {s.plannedDays !== null && (
                          <span
                            aria-hidden
                            className="bg-foreground absolute -top-1 h-[18px] w-0.5 rounded-full"
                            style={{ left: `${(s.plannedDays / maxDays) * 100}%` }}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            On-time rate counts tasks and paper stages that had a due date. Awards need at least {MIN_FOR_RANKING}{" "}
            tasks.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4 sm:pl-2">Member</TableHead>
                <TableHead className="text-right">Done</TableHead>
                <TableHead className="min-w-36">On time</TableHead>
                <TableHead className="text-right">Avg time</TableHead>
                <TableHead className="text-right">Pages</TableHead>
                <TableHead className="pr-4 text-right sm:pr-2">Open now</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perf.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="pl-4 sm:pl-2">
                    <div className="flex items-center gap-2.5">
                      <Person m={m} avatar={avatarOf(m)} />
                      <span className="font-medium">{m.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.done}</TableCell>
                  <TableCell>
                    {m.onTimeRate === null ? (
                      <span className="text-muted-foreground text-xs">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Progress value={m.onTimeRate} className="h-1.5 w-20" aria-label={`${m.onTimeRate}% on time`} />
                        <span className="text-xs tabular-nums">
                          {m.onTimeRate}%{" "}
                          <span className="text-muted-foreground">
                            ({m.onTime}/{m.withDue})
                          </span>
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{days(m.avgDays)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.pages || "—"}</TableCell>
                  <TableCell className="pr-4 text-right sm:pr-2">
                    {m.overdueNow > 0 ? (
                      <Badge variant="destructive">
                        <TriangleAlertIcon /> {m.overdueNow} overdue
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm tabular-nums">{m.openNow || "—"}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
