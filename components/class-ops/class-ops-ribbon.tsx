"use client";

import Link from "next/link";
import { BookCopyIcon, CalendarClockIcon, ClockAlertIcon, UploadIcon } from "lucide-react";
import CountUp from "@/components/reactbits/count-up";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { Button } from "@/components/ui/button";
import { isPaidCountStale, paidProgressPct } from "@/lib/class-ops/helpers";
import type { ClassRow } from "@/lib/class-ops/queries";
import { monthLabel, shiftMonth } from "@/lib/core/month";
import { cn } from "@/lib/utils";

/**
 * Top Operations Readiness Ribbon matching the Printroom ShelfRibbon language.
 * Summarizes active classes, total paid vs expected copies, stale counts, and
 * next-month tute planning gaps in one calm scannable strip.
 */
export function ClassOpsRibbon({
  classes,
  month,
  isThisMonth,
  staleOnly,
  onToggleStaleOnly,
  onOpenPlan,
}: {
  classes: ClassRow[];
  month: string;
  isThisMonth: boolean;
  staleOnly: boolean;
  onToggleStaleOnly: () => void;
  onOpenPlan: () => void;
}) {
  const active = classes.filter((c) => c.is_active);
  const nextMonth = shiftMonth(month, 1);

  const paidTotal = active.reduce((sum, c) => sum + (c.paid ?? 0), 0);
  const expectedTotal = active.reduce((sum, c) => sum + c.expected, 0);
  const progressPct = paidProgressPct(paidTotal, expectedTotal);

  const missingNextPlan = active.filter((c) => c.tutes_next === 0).length;
  const staleCount = isThisMonth ? active.filter((c) => isPaidCountStale(c.paid_at, true)).length : 0;

  return (
    <SpotlightCard
      className="hover:translate-y-0 hover:shadow-sm"
      spotlightColor="color-mix(in oklch, var(--primary) 10%, transparent)"
    >
      <div className="flex flex-col gap-3.5 p-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Summary + proportional paid progress bar */}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h2 className="text-sm font-semibold tracking-tight">{monthLabel(month)} class overview</h2>
              <span className="text-muted-foreground text-xs tabular-nums">
                {active.length} active class{active.length === 1 ? "" : "es"}
              </span>
            </div>

            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs tabular-nums">
              {expectedTotal > 0 ? (
                <span>
                  <CountUp to={paidTotal} duration={0.6} className="text-foreground font-semibold" /> of{" "}
                  <CountUp to={expectedTotal} duration={0.6} className="text-foreground font-semibold" /> paid ({progressPct}%)
                </span>
              ) : (
                <span>No paid counts yet</span>
              )}
            </div>
          </div>

          <div
            className="bg-background flex h-2.5 w-full overflow-hidden rounded-full border p-0.5"
            role="img"
            aria-label={`${paidTotal} of ${expectedTotal} students paid (${progressPct}%)`}
          >
            <div
              style={{ width: `${progressPct}%` }}
              className="bg-primary h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
            />
          </div>
        </div>

        {/* Actionable status pills + 1-click workflow cross-links */}
        <div className="flex flex-wrap items-center gap-1.5 lg:shrink-0">
          {staleCount > 0 && (
            <button
              type="button"
              onClick={onToggleStaleOnly}
              aria-pressed={staleOnly}
              className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                staleOnly
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-warning",
              )}
            >
              <ClockAlertIcon className="size-3.5" />
              <span className="tabular-nums">
                {staleCount} need{staleCount === 1 ? "s" : ""} update
              </span>
            </button>
          )}

          {missingNextPlan > 0 && (
            <button
              type="button"
              onClick={onOpenPlan}
              className="border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 focus-visible:ring-ring/50 dark:text-warning inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
            >
              <CalendarClockIcon className="size-3.5" />
              <span className="tabular-nums">
                {missingNextPlan} missing {monthLabel(nextMonth, "short")} plan
              </span>
            </button>
          )}

          <Button asChild size="sm" variant="outline" className="h-8 text-xs">
            <Link href="/admin/fee-reminders">
              <UploadIcon className="size-3.5" /> Paid list
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-8 text-xs">
            <Link href={`/admin/tutes?month=${month}`}>
              <BookCopyIcon className="size-3.5" /> Tute stock
            </Link>
          </Button>
        </div>
      </div>
    </SpotlightCard>
  );
}
