"use client";

import {
  BadgeCheckIcon,
  BanknoteIcon,
  CalculatorIcon,
  ClipboardCheckIcon,
  HistoryIcon,
  LandmarkIcon,
  ShieldCheckIcon,
  UserCogIcon,
  type LucideIcon,
} from "lucide-react";
import AnimatedList from "@/components/reactbits/animated-list";
import { Badge } from "@/components/ui/badge";
import { activityGroupLabel, activityTone } from "@/lib/activity";
import { cn } from "@/lib/utils";

export type ActivityItem = {
  id: number;
  createdAt: string;
  /** "5 min ago" (formatted on the server so it matches after hydration). */
  when: string;
  /** Full date and time for the tooltip. */
  whenFull: string;
  actorName: string;
  action: string;
  summary: string;
  targetName: string | null;
  comment: string | null;
};

const ICONS: Record<string, LucideIcon> = {
  submission: ClipboardCheckIcon,
  month: BanknoteIcon,
  payout: BadgeCheckIcon,
  payroll: BanknoteIcon,
  rate: CalculatorIcon,
  salary: CalculatorIcon,
  budget: CalculatorIcon,
  role: UserCogIcon,
  member: UserCogIcon,
  bank: LandmarkIcon,
  two_step: ShieldCheckIcon,
};

const TONES = {
  success: "bg-success/15 text-success",
  danger: "bg-destructive/15 text-destructive",
  warning: "bg-warning/20 text-amber-700 dark:text-warning",
  info: "bg-chart-2/15 text-chart-2",
  neutral: "bg-muted text-muted-foreground",
} as const;

/** The activity log as an animated list (React Bits AnimatedList). */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <AnimatedList
      aria-label="Activity"
      items={items.map((item) => {
        const group = item.action.split(".")[0];
        const Icon = ICONS[group] ?? HistoryIcon;
        const tone = activityTone(item.action);
        return {
          key: item.id,
          node: (
            <div className="bg-card hover:bg-accent/40 flex gap-3 rounded-xl border p-3 transition-colors sm:p-4">
              <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONES[tone])}>
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm leading-snug">
                  <span className="font-semibold">{item.actorName}</span>{" "}
                  <span className="text-foreground/90">{item.summary.charAt(0).toLowerCase() + item.summary.slice(1)}</span>
                </p>
                {item.comment && (
                  <p className="text-muted-foreground border-l-2 pl-2 text-xs italic">“{item.comment}”</p>
                )}
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <Badge variant="outline" className="h-5">
                    {activityGroupLabel(item.action)}
                  </Badge>
                  <time dateTime={item.createdAt} title={item.whenFull}>
                    {item.when}
                  </time>
                </div>
              </div>
            </div>
          ),
        };
      })}
    />
  );
}
