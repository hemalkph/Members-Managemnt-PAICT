import type * as React from "react";
import { AnimateIcon } from "@animate-ui/react/icons";
import CountUp from "@/components/reactbits/count-up";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { cn } from "@/lib/utils";

const TONES = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-amber-600 dark:text-warning",
  info: "bg-chart-2/15 text-chart-2",
} as const;

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "primary",
  delay = 0,
  prefix,
  suffix,
  decimals = 0,
}: {
  label: string;
  value: number;
  /** A lucide icon, or an animated Hugeicon (it draws in when the card appears and on hover). */
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  tone?: keyof typeof TONES;
  delay?: number;
  /** Shown before the number, e.g. "Rs. ". */
  prefix?: string;
  /** Shown after the number, e.g. "%" or " days". */
  suffix?: string;
  decimals?: number;
}) {
  return (
    <SpotlightCard className="p-3 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground line-clamp-2 text-xs leading-tight font-medium sm:text-sm">{label}</p>
          <p className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {prefix && <span className="text-muted-foreground mr-0.5 text-base font-medium sm:text-lg">{prefix}</span>}
            <CountUp key={value} to={value} delay={delay} decimals={decimals} />
            {suffix && <span className="text-muted-foreground ml-0.5 text-base font-medium sm:text-lg">{suffix}</span>}
          </p>
          {hint && <p className="text-muted-foreground truncate text-xs">{hint}</p>}
        </div>
        <AnimateIcon
          animateOnView
          animateOnHover
          className={cn("hidden size-10 shrink-0 items-center justify-center rounded-lg sm:flex", TONES[tone])}
        >
          <Icon className="size-5" />
        </AnimateIcon>
      </div>
    </SpotlightCard>
  );
}
