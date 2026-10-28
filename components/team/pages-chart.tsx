"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "motion/react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const config: ChartConfig = { pages: { label: "Pages", color: "var(--chart-1)" } };

/** Approved pages (type setting + conversion) per month – one series, so no legend. */
export function PagesChart({ data }: { data: { label: string; pages: number }[] }) {
  const reduceMotion = useReducedMotion();
  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 4, left: -16, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<ChartTooltipContent />} />
        <Bar
          dataKey="pages"
          fill="var(--color-pages)"
          radius={[4, 4, 0, 0]}
          maxBarSize={48}
          isAnimationActive={!reduceMotion}
        />
      </BarChart>
    </ChartContainer>
  );
}
