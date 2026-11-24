"use client";

import { AlarmClockIcon } from "lucide-react";
import CountUp from "@/components/reactbits/count-up";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import type { StockFilter } from "@/components/tutes/shared";
import { monthLabel } from "@/lib/core/month";
import type { TuteStockRow } from "@/lib/supabase/database.types";
import { leftThisMonth } from "@/lib/tutes/helpers";
import { cn } from "@/lib/utils";

/**
 * Unified Shelf Readiness Ribbon replacing 4 static KPI rectangles.
 * Shows the batch's monthly readiness as one proportional health bar plus
 * clickable status filters that stay quiet when zero.
 */
export function ShelfRibbon({
  rows,
  lateJobsCount,
  month,
  activeFilter,
  onSelectFilter,
  onOpenLateJobs,
}: {
  rows: TuteStockRow[];
  lateJobsCount: number;
  month: string;
  activeFilter: StockFilter;
  onSelectFilter: (filter: StockFilter) => void;
  onOpenLateJobs: () => void;
}) {
  const outCount = rows.filter((r) => r.status === "out").length;
  const lowCount = rows.filter((r) => r.status === "low").length;
  const notCountedCount = rows.filter((r) => r.status === "not_counted").length;
  const okCount = rows.filter((r) => r.status === "ok").length;
  const scheduledTotal = outCount + lowCount + notCountedCount + okCount;

  const totalLeft = rows.reduce((sum, r) => sum + leftThisMonth(r), 0);
  const totalPrinting = rows.reduce((sum, r) => sum + r.in_print, 0);
  const printingTutes = rows.filter((r) => r.in_print > 0).length;

  const segments = [
    { key: "ok", count: okCount, colorClass: "bg-success", label: `${okCount} ready` },
    { key: "low", count: lowCount, colorClass: "bg-amber-500 dark:bg-warning", label: `${lowCount} low` },
    { key: "out", count: outCount, colorClass: "bg-destructive", label: `${outCount} out` },
    {
      key: "not_counted",
      count: notCountedCount,
      colorClass: "bg-muted-foreground/35",
      label: `${notCountedCount} uncounted`,
    },
  ].filter((s) => s.count > 0);

  const toggle = (key: StockFilter) => onSelectFilter(activeFilter === key ? "all" : key);

  const chips: { key: StockFilter; label: string; count: number; dotClass: string }[] = [
    { key: "out", label: "Out", count: outCount, dotClass: "bg-destructive" },
    { key: "low", label: "Low", count: lowCount, dotClass: "bg-amber-500 dark:bg-warning" },
    { key: "not_counted", label: "Uncounted", count: notCountedCount, dotClass: "bg-muted-foreground/60" },
    { key: "printing", label: "At press", count: printingTutes, dotClass: "bg-primary" },
    { key: "ok", label: "Ready", count: okCount, dotClass: "bg-success" },
  ];

  return (
    <SpotlightCard
      className="hover:translate-y-0 hover:shadow-sm"
      spotlightColor="color-mix(in oklch, var(--primary) 10%, transparent)"
    >
      <div className="flex flex-col gap-3.5 p-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Readiness headline + proportional segmented bar */}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h2 className="text-sm font-semibold tracking-tight">
                {monthLabel(month)} shelf readiness
              </h2>
              <span className="text-muted-foreground text-xs tabular-nums">
                {scheduledTotal === 0
                  ? "No active tutes yet"
                  : `${okCount} of ${scheduledTotal} ready${outCount + lowCount > 0 ? ` · ${outCount + lowCount} short` : ""}${notCountedCount > 0 ? ` · ${notCountedCount} uncounted` : ""}`}
              </span>
            </div>

            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs tabular-nums">
              {totalLeft > 0 && (
                <span>
                  <CountUp to={totalLeft} duration={0.6} className="text-foreground font-semibold" /> copies still to give
                </span>
              )}
              {totalPrinting > 0 && (
                <span>
                  · <CountUp to={totalPrinting} duration={0.6} className="text-primary font-semibold" /> printing
                </span>
              )}
            </div>
          </div>

          <div
            className="bg-background flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full border p-0.5"
            role="img"
            aria-label={segments.map((s) => s.label).join(", ") || "No active tutes"}
          >
            {segments.length === 0 ? (
              <div className="bg-muted h-full w-full rounded-full" />
            ) : (
              segments.map((s) => (
                <div
                  key={s.key}
                  style={{ width: `${(s.count / Math.max(scheduledTotal, 1)) * 100}%` }}
                  className={cn("h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none", s.colorClass)}
                  title={s.label}
                />
              ))
            )}
          </div>
        </div>

        {/* Clickable health filters + late print jobs jump */}
        <div className="flex flex-wrap items-center gap-1.5 lg:shrink-0">
          {chips.map((c) => {
            const active = activeFilter === c.key;
            const muted = c.count === 0 && !active;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggle(c.key)}
                aria-pressed={active}
                className={cn(
                  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                  "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "bg-background/70 hover:bg-accent/70 text-foreground border-border",
                  muted && "opacity-45 hover:opacity-80",
                )}
              >
                <span className={cn("size-2 rounded-full", c.count > 0 ? c.dotClass : "bg-border")} />
                <span>{c.label}</span>
                <span className="font-semibold tabular-nums">{c.count}</span>
              </button>
            );
          })}

          {lateJobsCount > 0 && (
            <button
              type="button"
              onClick={onOpenLateJobs}
              className="border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15 focus-visible:ring-destructive/40 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
            >
              <AlarmClockIcon className="size-3.5" />
              <span>{lateJobsCount} late</span>
            </button>
          )}
        </div>
      </div>
    </SpotlightCard>
  );
}
