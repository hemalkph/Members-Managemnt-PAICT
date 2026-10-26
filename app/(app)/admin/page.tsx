import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  CakeIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  ClockIcon,
  InboxIcon,
  UsersIcon,
} from "lucide-react";
import { SectionChart } from "@/components/admin/section-chart";
import BlurText from "@/components/reactbits/blur-text";
import { EmptyState } from "@/components/empty-state";
import { NoticeBoard } from "@/components/notice-board";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { formatBirthday, ordinal } from "@/lib/birthday";
import { getBirthdays } from "@/lib/birthday-queries";
import { getCurrentNotices } from "@/lib/notices";
import { formatDateTime } from "@/lib/format";
import { currentMonthKey, monthKeyToDate, monthLabel, todayISO } from "@/lib/month";
import { getStructure } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin overview" };

export default async function AdminDashboardPage() {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const month = currentMonthKey();

  const [members, monthRows, pendingAll, recent, structure, birthdays, notices] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("submissions").select("status, role_id").eq("work_month", monthKeyToDate(month)),
    supabase.from("submissions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("submissions")
      .select(
        "id, title, status, created_at, quantity, member:profiles!submissions_user_id_fkey(full_name, email), roles(name)",
      )
      .order("created_at", { ascending: false })
      .limit(8),
    getStructure(supabase),
    getBirthdays(supabase, todayISO(), 30),
    getCurrentNotices(supabase, 3),
  ]);

  const rows = monthRows.data ?? [];
  const sectionOfRole = new Map(structure.flatMap((s) => s.roles.map((r) => [r.id, s.name] as const)));
  const chartData = structure.map((s) => ({ section: s.name, approved: 0, pending: 0, rejected: 0 }));
  const bySection = new Map(chartData.map((d) => [d.section, d]));
  for (const row of rows) {
    const datum = bySection.get(sectionOfRole.get(row.role_id) ?? "");
    if (datum) datum[row.status] += 1;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <BlurText as="h1" text="Team overview" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
          <p className="text-muted-foreground text-sm">
            Welcome, {profile.full_name.split(" ")[0] || "admin"}. Figures for {monthLabel(month)}.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/review?status=pending">
            <ClipboardCheckIcon /> Review pending work
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active members" value={members.count ?? 0} icon={UsersIcon} />
        <StatCard label="Submissions this month" value={rows.length} icon={InboxIcon} tone="info" delay={0.1} />
        <StatCard
          label="Pending reviews"
          value={pendingAll.count ?? 0}
          icon={ClockIcon}
          tone="warning"
          hint="All months"
          delay={0.2}
        />
        <StatCard
          label="Approved this month"
          value={rows.filter((r) => r.status === "approved").length}
          icon={CheckCircle2Icon}
          tone="success"
          delay={0.3}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Submissions per section</CardTitle>
            <CardDescription>{monthLabel(month)}</CardDescription>
          </CardHeader>
          <CardContent>
            {structure.length === 0 ? (
              <p className="text-muted-foreground text-sm">Add sections and roles to see this chart.</p>
            ) : (
              <SectionChart data={chartData} />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent submissions</CardTitle>
            <CardDescription>Latest work logged by the team</CardDescription>
          </CardHeader>
          <CardContent>
            {(recent.data ?? []).length === 0 ? (
              <EmptyState icon={InboxIcon} title="No submissions yet" className="py-8" />
            ) : (
              <ul className="divide-y">
                {(recent.data ?? []).map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.title}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {s.member?.full_name || s.member?.email} · {s.roles?.name} · {formatDateTime(s.created_at)}
                      </p>
                    </div>
                    <StatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="ghost" size="sm" className="mt-3 w-full">
              <Link href="/admin/review">
                Open work review <ArrowRightIcon />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <NoticeBoard notices={notices} manageHref="/admin/notices" />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CakeIcon className="text-primary size-5" /> Upcoming birthdays
            </CardTitle>
            <CardDescription>Next 30 days, from members&apos; NIC numbers</CardDescription>
          </CardHeader>
          <CardContent>
            {birthdays.length === 0 ? (
              <p className="text-muted-foreground text-sm">No birthdays in the next 30 days.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {birthdays.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/admin/members/${b.id}`}
                      className={
                        b.daysUntil === 0
                          ? "border-primary/40 bg-primary/5 flex items-center gap-3 rounded-lg border p-3"
                          : "hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-3"
                      }
                    >
                      <span className="text-xl" aria-hidden>
                        {b.daysUntil === 0 ? "🎉" : "🎂"}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{b.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {formatBirthday(b.dateOfBirth)} · {ordinal(b.turning)} ·{" "}
                          {b.daysUntil === 0 ? "today!" : b.daysUntil === 1 ? "tomorrow" : `in ${b.daysUntil} days`}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
