import Link from "next/link";
import { CalendarClockIcon, FilePlus2Icon } from "lucide-react";
import CountUp from "@/components/reactbits/count-up";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { MonthDeadline } from "@/lib/deadlines";
import { monthLabel, shiftMonth } from "@/lib/month";
import { cn } from "@/lib/utils";

/**
 * "Get your October work in by 10 Nov · 5 days left" for the member dashboard.
 * `progress` = how much of the month's period (11th → 10th) has passed (0–100).
 */
export function DeadlineCard({ deadline, progress }: { deadline: MonthDeadline; progress: number }) {
  if (!deadline.deadline || deadline.passed || deadline.daysLeft === null) return null;
  const urgent = deadline.daysLeft <= 3;
  const lastDay = deadline.daysLeft <= 1;

  return (
    <SpotlightCard
      className={cn("p-4 sm:p-5", urgent && "border-warning/60 bg-warning/5")}
      spotlightColor={urgent ? "color-mix(in oklch, var(--warning) 22%, transparent)" : undefined}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg",
              urgent ? "bg-warning/25 text-amber-700 dark:text-warning" : "bg-primary/10 text-primary",
            )}
          >
            <CalendarClockIcon className="size-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">Get your {monthLabel(deadline.month)} work in</p>
            </div>
            <p className="text-muted-foreground text-sm">
              {monthLabel(deadline.month)} ends on{" "}
              <span className="text-foreground font-medium">{deadline.lastDayLabel}</span>. Work approved after that counts
              for {monthLabel(shiftMonth(deadline.month, 1))}.
            </p>
            <Progress
              value={progress}
              aria-label="How much of the month has passed"
              indicatorClassName={urgent ? "bg-warning" : undefined}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
          <p className={cn("text-right leading-none", urgent && "text-amber-700 dark:text-warning")}>
            {lastDay ? (
              <span className="text-2xl font-semibold">Last day!</span>
            ) : (
              <>
                <span className="text-3xl font-semibold tabular-nums">
                  <CountUp to={deadline.daysLeft} />
                </span>
                <span className="text-muted-foreground ml-1 text-sm">days left</span>
              </>
            )}
          </p>
          <Button asChild size="sm" variant={urgent ? "default" : "outline"}>
            <Link href="/work/new">
              <FilePlus2Icon /> Log work
            </Link>
          </Button>
        </div>
      </div>
    </SpotlightCard>
  );
}
