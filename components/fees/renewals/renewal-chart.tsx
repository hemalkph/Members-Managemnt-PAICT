"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "motion/react";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { targetShare } from "@/lib/fees/renewals";

const config: ChartConfig = {
  renewed: { label: "Renewed", color: "var(--chart-1)" },
  target: { label: "Target", color: "var(--muted-foreground)" },
};

/** % of last month's students who have paid, by day of the month, against the target line. */
export function RenewalChart({
  month,
  history,
  dueDay,
  targetPct,
}: {
  month: string;
  history: { day: number; pct: number }[];
  dueDay: number;
  targetPct: number;
}) {
  const reduceMotion = useReducedMotion();
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const byDay = new Map(history.map((h) => [h.day, h.pct]));
  const data = Array.from({ length: lastDay }, (_, i) => {
    const day = i + 1;
    return { day, renewed: byDay.get(day) ?? null, target: Math.round(targetShare(day, dueDay, targetPct)) };
  });

  return (
    <ChartContainer config={config} className="aspect-auto h-[180px] w-full">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={6} interval={4} />
        <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickLine={false} axisLine={false} width={44} unit="%" />
        <ChartTooltip
          cursor={{ stroke: "var(--border)" }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => `Day ${p?.[0]?.payload?.day ?? ""}`}
              valueFormatter={(v) => `${v}%`}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey="target"
          stroke="var(--color-target)"
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
          activeDot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="renewed"
          stroke="var(--color-renewed)"
          strokeWidth={2}
          connectNulls
          dot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--color-renewed)" }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
          isAnimationActive={!reduceMotion}
        />
      </LineChart>
    </ChartContainer>
  );
}
