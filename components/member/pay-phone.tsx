"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BadgeCheckIcon,
  BriefcaseIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ClockIcon,
  FlameIcon,
  ListTodoIcon,
  SparklesIcon,
  TrendingUpIcon,
} from "lucide-react";
import { PhoneMockup } from "@/components/phone-mockup";
import CountUp from "@/components/reactbits/count-up";
import ShinyText from "@/components/reactbits/shiny-text";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { createClient } from "@/lib/supabase/client";
import { formatLKR } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PhoneDueItem = { id: string; title: string; dueLabel: string | null; overdue: boolean; high: boolean; href: string };
export type PhoneDoneItem = { id: string; title: string; amount: number };

type Props = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  month: string;
  monthName: string;
  /** Day of the month today (1–31) and how many days the month has. */
  day: number;
  daysInMonth: number;
  /** Full fixed monthly salary, and how much of it is earned so far. */
  salary: number;
  salaryEarned: number;
  workApproved: number;
  workPending: number;
  doneCount: number;
  dueCount: number;
  overdueCount: number;
  due: PhoneDueItem[];
  done: PhoneDoneItem[];
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** Read/write the last total this member saw, so the counter starts from there. */
function storageKey(userId: string, month: string) {
  return `pay-phone:${userId}:${month}`;
}
function readSeen(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw === null ? null : Number(raw);
    return n !== null && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
function writeSeen(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage is optional.
  }
}

/**
 * A phone screen on the dashboard showing what the member will be paid this
 * month. The total counts up: fixed salary grows day by day, and each piece of
 * work an admin approves is added on top (live, without reloading the page).
 */
export function PayPhone(props: Props) {
  const {
    userId,
    name,
    avatarUrl,
    month,
    monthName,
    day,
    daysInMonth,
    salary,
    salaryEarned,
    workApproved,
    workPending,
    doneCount,
    dueCount,
    overdueCount,
    due,
    done,
  } = props;
  const router = useRouter();
  const reduce = useReducedMotion();
  const total = Math.round((salaryEarned + workApproved) * 100) / 100;
  const key = storageKey(userId, month);

  // The total this member last saw (null on the first visit this month).
  const [seen] = useState(() => (typeof window === "undefined" ? null : readSeen(key)));
  // The counter starts there, so only new money "counts up" on a return visit.
  const [from] = useState(() => Math.min(seen ?? 0, total));
  // The total already celebrated with a "+Rs …" bubble.
  const [base, setBase] = useState(() => seen ?? total);
  const [gain, setGain] = useState<{ id: number; amount: number } | null>(null);
  if (total < base) setBase(total); // e.g. approved work was removed

  useEffect(() => {
    writeSeen(key, total);
    if (total - base < 0.01) return;
    // Let the counter start first, then show what was added.
    const timer = setTimeout(() => {
      setGain({ id: Date.now(), amount: total - base });
      setBase(total);
    }, 300);
    return () => clearTimeout(timer);
  }, [key, total, base]);

  useEffect(() => {
    if (!gain) return;
    const timer = setTimeout(() => setGain(null), 4000);
    return () => clearTimeout(timer);
  }, [gain]);

  // When an admin approves work, a notification arrives: refresh the numbers.
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    const channel = supabase
      .channel(`pay-phone:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, refresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId, router]);

  const perDay = daysInMonth > 0 ? salary / daysInMonth : 0;
  const salaryPct = salary > 0 ? Math.round((salaryEarned / salary) * 100) : 0;
  const firstName = name.split(" ")[0] || name;

  const cheer =
    overdueCount > 0
      ? `Finish ${overdueCount} overdue task${overdueCount === 1 ? "" : "s"} first – you've got this!`
      : workPending > 0
        ? `${formatLKR(workPending)} more is waiting for review.`
        : dueCount > 0
          ? `${dueCount} task${dueCount === 1 ? "" : "s"} to go. Every approved piece adds to your pay.`
          : doneCount > 0
            ? "All caught up – great work this month!"
            : "Log your first work this month to start earning.";

  return (
    <PhoneMockup className="w-[300px]">
      <div data-lenis-prevent className="space-y-3 px-3.5 pt-1 pb-3">
        {/* Who */}
        <div className="flex items-center gap-2.5">
          <Avatar className="ring-primary/60 ring-offset-background size-10 ring-2 ring-offset-2">
            {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm leading-tight font-semibold">Hi, {firstName}</p>
            <p className="text-muted-foreground text-[11px]">{monthName}</p>
          </div>
          <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full rounded-full bg-emerald-500 opacity-75 motion-safe:animate-ping" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        </div>

        {/* Pay */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0838a8] via-[#0868d8] to-[#08b8f8] p-3.5 text-white shadow-lg shadow-[#0868d8]/25">
          <div aria-hidden className="absolute -top-10 -right-8 size-28 rounded-full bg-white/15 blur-xl" />
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-white/85">
            <TrendingUpIcon className="size-3.5" /> Your pay this month
          </p>
          <p className="mt-1 flex items-baseline gap-1 text-[26px] leading-none font-bold tracking-tight">
            <span className="text-sm font-semibold text-white/85">Rs.</span>
            <CountUp key={key} from={from} to={total} decimals={2} duration={1.6} />
          </p>
          <AnimatePresence>
            {gain && (
              <motion.span
                key={gain.id}
                className="absolute top-3 right-3 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-emerald-600 shadow"
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -14 }}
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 20 }}
              >
                +{formatLKR(gain.amount)}
              </motion.span>
            )}
          </AnimatePresence>
          <p className="mt-1.5 text-[11px] text-white/80">
            Day {day} of {daysInMonth}
            {workPending > 0 && <> · +{formatLKR(workPending)} in review</>}
          </p>

          <div className="mt-3 space-y-2 rounded-xl bg-white/12 p-2.5 text-[11px] backdrop-blur-sm">
            {salary > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-white/85">
                    <BriefcaseIcon className="size-3" /> Salary so far
                  </span>
                  <span className="font-semibold tabular-nums">{formatLKR(salaryEarned)}</span>
                </div>
                <Progress
                  value={salaryPct}
                  aria-label={`Salary earned: ${salaryPct}%`}
                  className="h-1.5 bg-white/20"
                  indicatorClassName="bg-white"
                />
                <p className="text-[10px] text-white/70">
                  +{formatLKR(perDay)} every day · {formatLKR(salary)} by the month end
                </p>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-white/85">
                <BadgeCheckIcon className="size-3" /> Approved work
              </span>
              <span className="font-semibold tabular-nums">{formatLKR(workApproved)}</span>
            </div>
          </div>
        </div>

        {/* Due / done counts */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5">
            <p className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 uppercase dark:text-amber-400">
              <ClockIcon className="size-3" /> Due
            </p>
            <p className="mt-0.5 text-xl leading-none font-bold">
              <CountUp to={dueCount} />
            </p>
            <p className="text-muted-foreground mt-0.5 text-[10px]">
              {overdueCount > 0 ? <span className="text-destructive font-semibold">{overdueCount} overdue</span> : "tasks to do"}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5">
            <p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 uppercase dark:text-emerald-400">
              <CheckCircle2Icon className="size-3" /> Done
            </p>
            <p className="mt-0.5 text-xl leading-none font-bold">
              <CountUp to={doneCount} />
            </p>
            <p className="text-muted-foreground mt-0.5 text-[10px]">approved this month</p>
          </div>
        </div>

        {/* Due work */}
        <section className="space-y-1.5">
          <h3 className="flex items-center gap-1 text-xs font-semibold">
            <ListTodoIcon className="text-primary size-3.5" /> Due work
          </h3>
          {due.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-2 text-center text-[11px]">No tasks waiting</p>
          ) : (
            <ul className="space-y-1.5">
              {due.map((t) => (
                <li key={t.id}>
                  <Link
                    href={t.href}
                    className={cn(
                      "hover:bg-accent/60 block rounded-lg border p-2 transition-colors",
                      t.overdue && "border-destructive/40 bg-destructive/5",
                    )}
                  >
                    <p className="flex items-center gap-1 text-[11px] font-medium">
                      {t.high && <FlameIcon className="text-destructive size-3 shrink-0" />}
                      <span className="truncate">{t.title}</span>
                    </p>
                    {t.dueLabel && (
                      <p
                        className={cn(
                          "text-muted-foreground mt-0.5 flex items-center gap-1 text-[10px]",
                          t.overdue && "text-destructive font-semibold",
                        )}
                      >
                        <CalendarClockIcon className="size-2.5" /> {t.dueLabel}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Done work */}
        <section className="space-y-1.5">
          <h3 className="flex items-center gap-1 text-xs font-semibold">
            <CheckCircle2Icon className="size-3.5 text-emerald-600 dark:text-emerald-400" /> Done work
          </h3>
          {done.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-2 text-center text-[11px]">
              Nothing approved yet
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {done.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]">
                  <span className="truncate">{s.title}</span>
                  {s.amount > 0 && (
                    <span className="shrink-0 font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                      +{formatLKR(s.amount)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Encouragement */}
        <div className="from-primary/10 to-chart-2/10 flex items-start gap-1.5 rounded-xl bg-gradient-to-r p-2.5">
          <SparklesIcon className="text-primary mt-0.5 size-3.5 shrink-0" />
          <ShinyText text={cheer} className="text-[11px] leading-snug font-medium" />
        </div>
      </div>
    </PhoneMockup>
  );
}
