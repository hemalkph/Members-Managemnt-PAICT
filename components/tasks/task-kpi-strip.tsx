"use client";

import type { LucideIcon } from "lucide-react";
import CountUp from "@/components/reactbits/count-up";
import { cn } from "@/lib/utils";

export type TaskKpiItem = {
  key: string;
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  tone: "primary" | "destructive" | "warning" | "info" | "success";
  active?: boolean;
  onClick?: () => void;
};

const TONE_ICON: Record<TaskKpiItem["tone"], string> = {
  primary: "text-primary bg-primary/10",
  destructive: "text-destructive bg-destructive/12",
  warning: "text-amber-600 bg-amber-500/12 dark:text-warning dark:bg-warning/15",
  info: "text-chart-2 bg-chart-2/12",
  success: "text-success bg-success/12",
};

const TONE_RING: Record<TaskKpiItem["tone"], string> = {
  primary: "border-primary/60 ring-2 ring-primary/15",
  destructive: "border-destructive/60 ring-2 ring-destructive/15",
  warning: "border-amber-500/60 ring-2 ring-amber-500/15 dark:border-warning/60 dark:ring-warning/15",
  info: "border-chart-2/60 ring-2 ring-chart-2/15",
  success: "border-success/60 ring-2 ring-success/15",
};

const TONE_VALUE: Record<TaskKpiItem["tone"], string> = {
  primary: "text-foreground",
  destructive: "text-destructive",
  warning: "text-amber-600 dark:text-warning",
  info: "text-foreground",
  success: "text-foreground",
};

/**
 * Clean 4-column KPI strip inspired by the reference portal layout:
 * subtle icon + label on top, bold tabular metric in the middle, contextual hint at bottom,
 * faint concentric corner rings, and 1-click quick filtering.
 */
export function TaskKpiStrip({ items }: { items: TaskKpiItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {items.map((item, idx) => {
        const Icon = item.icon;
        const interactive = Boolean(item.onClick);
        const Comp = interactive ? "button" : "div";

        return (
          <Comp
            key={item.key}
            type={interactive ? "button" : undefined}
            onClick={item.onClick}
            aria-pressed={interactive ? Boolean(item.active) : undefined}
            className={cn(
              "bg-card text-card-foreground group relative overflow-hidden rounded-xl border p-3.5 text-left shadow-xs transition-all sm:p-4",
              interactive && "cursor-pointer hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm",
              item.active && TONE_RING[item.tone],
            )}
          >
            {/* Faint concentric rings motif (bottom-right, matching reference Image 1) */}
            <svg
              aria-hidden="true"
              viewBox="0 0 120 120"
              className="text-foreground/[0.045] dark:text-foreground/[0.055] pointer-events-none absolute -right-4 -bottom-6 size-24 transition-transform duration-300 group-hover:scale-105"
              fill="none"
            >
              <circle cx="72" cy="72" r="24" stroke="currentColor" strokeWidth="1.25" />
              <circle cx="72" cy="72" r="40" stroke="currentColor" strokeWidth="1.25" />
              <circle cx="72" cy="72" r="56" stroke="currentColor" strokeWidth="1.25" />
            </svg>

            <div className="relative z-10 flex flex-col justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <span className={cn("inline-flex size-5.5 shrink-0 items-center justify-center rounded-md", TONE_ICON[item.tone])}>
                  <Icon className="size-3.5" />
                </span>
                <span className="text-muted-foreground truncate text-xs font-medium">{item.label}</span>
              </div>

              <div className="space-y-0.5">
                <p
                  className={cn(
                    "text-xl font-bold tracking-tight tabular-nums sm:text-2xl",
                    item.value > 0 && item.tone === "destructive" ? TONE_VALUE.destructive : "text-foreground",
                  )}
                >
                  <CountUp key={item.value} to={item.value} delay={idx * 0.06} />
                </p>
                <p className="text-muted-foreground truncate text-[11px]">{item.hint}</p>
              </div>
            </div>
          </Comp>
        );
      })}
    </div>
  );
}
