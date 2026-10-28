import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarCheckIcon,
  ChevronRightIcon,
  FileStackIcon,
  FlameIcon,
  HourglassIcon,
  ListTodoIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import BlurText from "@/components/reactbits/blur-text";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { Badge } from "@/components/ui/badge";
import { requireCompleteProfile } from "@/lib/auth";
import type { PaperStageName } from "@/lib/database.types";
import { formatDay, formatDayRange } from "@/lib/format";
import { todayISO } from "@/lib/month";
import { addDays, STAGE_LABEL } from "@/lib/papers";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My week" };

type Item = {
  key: string;
  kind: "stage" | "task";
  title: string;
  sub: string;
  href: string;
  first: string | null;
  last: string | null;
  waiting: boolean;
  high: boolean;
};

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });

function ItemRow({ item, day }: { item: Item; day?: string }) {
  const starts = day && item.first === day && item.first !== item.last;
  const due = day && item.last === day;
  return (
    <Link
      href={item.href}
      className={cn(
        "hover:bg-accent/50 flex items-center gap-3 rounded-lg border p-2.5 transition-colors",
        item.waiting && "border-dashed",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          item.kind === "stage" ? "bg-primary/10 text-primary" : "bg-chart-2/15 text-chart-2",
        )}
      >
        {item.kind === "stage" ? <FileStackIcon className="size-4" /> : <ListTodoIcon className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {item.high && <FlameIcon className="text-destructive size-3.5 shrink-0" />}
          <span className="truncate">{item.title}</span>
        </span>
        <span className="text-muted-foreground block truncate text-xs">{item.sub}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {item.waiting && (
          <Badge variant="outline" className="text-[10px]">
            <HourglassIcon /> Waiting
          </Badge>
        )}
        {starts && <Badge variant="secondary">Starts</Badge>}
        {due && <Badge variant={item.waiting ? "outline" : "default"}>Due</Badge>}
      </span>
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
    </Link>
  );
}

/**
 * The member's next 7 days: paper stages on their work days and tasks on
 * their due day. Overdue work first.
 */
export default async function MyWeekPage() {
  const profile = await requireCompleteProfile();
  const supabase = await createClient();
  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const end = days[6];

  const [{ data: stages }, { data: tasks }] = await Promise.all([
    supabase
      .from("paper_stages")
      .select("id, stage, status, start_date, due_date, paper:papers(id, title, status)")
      .eq("owner_id", profile.id)
      .in("status", ["waiting", "in_progress"]),
    supabase
      .from("tasks")
      .select("id, title, due_date, priority")
      .eq("assignee_id", profile.id)
      .eq("status", "open")
      .is("paper_stage_id", null),
  ]);

  const items: Item[] = [
    ...(
      (stages ?? []) as unknown as {
        id: string;
        stage: PaperStageName;
        status: "waiting" | "in_progress";
        start_date: string | null;
        due_date: string | null;
        paper: { id: string; title: string; status: string } | null;
      }[]
    )
      .filter((s) => s.paper?.status === "in_progress")
      .map((s) => ({
        key: s.id,
        kind: "stage" as const,
        title: `${STAGE_LABEL[s.stage]} – ${s.paper!.title}`,
        sub:
          (s.start_date || s.due_date ? `Work days: ${formatDayRange(s.start_date, s.due_date)}` : "No dates yet") +
          (s.status === "waiting" ? " · starts when the stage before is done" : ""),
        href: `/papers/${s.paper!.id}`,
        first: s.start_date ?? s.due_date,
        last: s.due_date ?? s.start_date,
        waiting: s.status === "waiting",
        high: false,
      })),
    ...(tasks ?? []).map((t) => ({
      key: t.id,
      kind: "task" as const,
      title: t.title,
      sub: t.due_date ? `Due ${formatDay(t.due_date)}` : "No due date",
      href: `/work/new?task=${t.id}`,
      first: t.due_date,
      last: t.due_date,
      waiting: false,
      high: t.priority === "high",
    })),
  ];

  const overdue = items.filter((i) => i.last && i.last < today);
  const byDay = days.map((d) => ({
    day: d,
    items: items.filter((i) => i.first && i.last && i.first <= d && d <= i.last && !(i.last < today)),
  }));
  const later = items
    .filter((i) => i.first && i.first > end)
    .sort((a, b) => a.first!.localeCompare(b.first!))
    .slice(0, 6);
  const undated = items.filter((i) => !i.first);
  const nothing = items.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <BlurText as="h1" text="My week" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
        <p className="text-muted-foreground text-sm">
          Your paper stages and tasks for the next 7 days. You also get a phone alert the evening before a stage starts.
        </p>
      </div>

      {nothing ? (
        <EmptyState
          icon={CalendarCheckIcon}
          title="Nothing planned for you"
          description="When an admin gives you a paper stage or task, it shows up here on its work days."
        />
      ) : (
        <>
          {overdue.length > 0 && (
            <SpotlightCard className="border-destructive/40 bg-destructive/5 space-y-2 p-4">
              <p className="text-destructive flex items-center gap-1.5 text-sm font-semibold">
                <TriangleAlertIcon className="size-4" /> Overdue – do these first
              </p>
              <div className="grid gap-2">
                {overdue.map((i) => (
                  <ItemRow key={i.key} item={i} />
                ))}
              </div>
            </SpotlightCard>
          )}

          <ol className="space-y-3">
            {byDay.map(({ day, items: dayItems }, idx) => (
              <li
                key={day}
                className={cn(
                  "grid gap-3 rounded-xl border p-3 sm:grid-cols-[110px_minmax(0,1fr)] sm:p-4",
                  idx === 0 && "border-primary/50 bg-primary/5",
                )}
              >
                <div className="flex items-baseline gap-2 sm:block">
                  <p className={cn("font-semibold", idx === 0 && "text-primary")}>
                    {idx === 0 ? "Today" : idx === 1 ? "Tomorrow" : WEEKDAY.format(new Date(`${day}T00:00:00Z`))}
                  </p>
                  <p className="text-muted-foreground text-xs">{formatDay(day)}</p>
                </div>
                {dayItems.length === 0 ? (
                  <p className="text-muted-foreground self-center text-sm">Free</p>
                ) : (
                  <div className="grid min-w-0 gap-2">
                    {dayItems.map((i) => (
                      <ItemRow key={i.key} item={i} day={day} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>

          {(later.length > 0 || undated.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {later.length > 0 && (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Later</p>
                  {later.map((i) => (
                    <ItemRow key={i.key} item={i} />
                  ))}
                </div>
              )}
              {undated.length > 0 && (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">No date</p>
                  {undated.map((i) => (
                    <ItemRow key={i.key} item={i} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
