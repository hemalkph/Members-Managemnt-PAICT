import { TriangleAlertIcon } from "lucide-react";
import type { StagePerformance } from "@/lib/performance";
import { cn } from "@/lib/utils";

const days = (n: number | null) => (n === null ? "—" : `${n} day${n === 1 ? "" : "s"}`);

/** Average days each paper stage took, with a marker for the planned work days. */
export function StageSpeed({ stages, empty }: { stages: StagePerformance[]; empty: string }) {
  const rows = stages.filter((s) => s.done > 0);
  if (rows.length === 0) return <p className="text-muted-foreground py-8 text-center text-sm">{empty}</p>;
  const maxDays = Math.max(1, ...rows.map((s) => Math.max(s.avgDays ?? 0, s.plannedDays ?? 0)));

  return (
    <ul className="space-y-3">
      {rows.map((s) => {
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
  );
}
