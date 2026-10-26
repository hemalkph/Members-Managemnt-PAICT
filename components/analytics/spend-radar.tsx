"use client";

import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from "recharts";
import { useReducedMotion } from "motion/react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatLKR } from "@/lib/format";
import { TrendNote } from "./trend-note";

const chartConfig = {
  spent: { label: "Spent", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Radar Chart – Dots: money spent on approved work, month by month. */
export function SpendRadar({
  data,
  change,
  rangeLabel,
}: {
  data: { month: string; spent: number }[];
  change: number | null;
  rangeLabel: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <CardTitle>Monthly spending</CardTitle>
        <CardDescription>Salaries + approved work, last {data.length} months</CardDescription>
      </CardHeader>
      <CardContent className="pb-0">
        <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[260px]">
          <RadarChart data={data}>
            <ChartTooltip cursor={false} content={<ChartTooltipContent valueFormatter={formatLKR} />} />
            <PolarAngleAxis dataKey="month" />
            <PolarGrid />
            <Radar
              dataKey="spent"
              fill="var(--color-spent)"
              fillOpacity={0.6}
              isAnimationActive={!reduceMotion}
              dot={{ r: 4, fillOpacity: 1 }}
            />
          </RadarChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col gap-2 text-sm">
        <TrendNote change={change} />
        <div className="text-muted-foreground flex items-center gap-2 leading-none">{rangeLabel}</div>
      </CardFooter>
    </Card>
  );
}
