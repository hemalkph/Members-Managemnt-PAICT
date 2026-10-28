"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "motion/react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatLKR, formatLKRCompact } from "@/lib/format";

/** One series per month (pages or rupees) – a single colour, so no legend; hover shows the value. */
export function MonthBars({
  data,
  label,
  money = false,
}: {
  data: { label: string; value: number }[];
  label: string;
  money?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const config: ChartConfig = { value: { label, color: "var(--chart-1)" } };
  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 4, left: money ? 4 : -16, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          width={money ? 64 : 44}
          tickFormatter={money ? (v: number) => formatLKRCompact(v) : undefined}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={<ChartTooltipContent valueFormatter={money ? formatLKR : undefined} />}
        />
        <Bar
          dataKey="value"
          fill="var(--color-value)"
          radius={[4, 4, 0, 0]}
          maxBarSize={48}
          isAnimationActive={!reduceMotion}
        />
      </BarChart>
    </ChartContainer>
  );
}
