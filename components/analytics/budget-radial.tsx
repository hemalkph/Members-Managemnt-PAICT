"use client";

import { Label, PolarGrid, PolarRadiusAxis, RadialBar, RadialBarChart } from "recharts";
import { useReducedMotion } from "motion/react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatLKR, formatLKRCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Radial Chart – Shape: this month's spending against the monthly budget. */
export function BudgetRadial({
  spent,
  pending,
  budget,
  monthLabel,
  action,
}: {
  spent: number;
  pending: number;
  budget: number;
  monthLabel: string;
  action?: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const ratio = budget > 0 ? spent / budget : 0;
  const over = budget > 0 && spent > budget;
  const color = over ? "var(--destructive)" : ratio > 0.8 ? "var(--warning)" : "var(--chart-2)";
  const chartConfig = { spent: { label: "Spent", color } } satisfies ChartConfig;
  const data = [{ name: "spent", spent: Math.max(spent, 0), fill: "var(--color-spent)" }];
  const sweep = budget > 0 ? Math.max(Math.min(ratio, 1) * 360, ratio > 0 ? 6 : 0) : 0;

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-0 text-center">
        <CardTitle>Budget used</CardTitle>
        <CardDescription>{monthLabel}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[260px]">
          <RadialBarChart data={data} startAngle={90} endAngle={90 - sweep} innerRadius={78} outerRadius={110}>
            <PolarGrid
              gridType="circle"
              radialLines={false}
              stroke="none"
              className="first:fill-muted last:fill-background"
              polarRadius={[86, 72]}
            />
            <RadialBar dataKey="spent" background cornerRadius={10} isAnimationActive={!reduceMotion} />
            <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                        <tspan x={viewBox.cx} y={(viewBox.cy || 0) - 6} className="fill-foreground text-3xl font-bold">
                          {budget > 0 ? `${Math.round(ratio * 100)}%` : formatLKRCompact(spent)}
                        </tspan>
                        <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 20} className="fill-muted-foreground">
                          {budget > 0 ? `of ${formatLKRCompact(budget)}` : "No budget set"}
                        </tspan>
                      </text>
                    );
                  }
                  return null;
                }}
              />
            </PolarRadiusAxis>
          </RadialBarChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col gap-2 text-sm">
        <div className={cn("flex items-center gap-2 leading-none font-medium", over && "text-destructive")}>
          {budget > 0
            ? over
              ? `Over budget by ${formatLKR(spent - budget)}`
              : `${formatLKR(budget - spent)} left this month`
            : `Spent ${formatLKR(spent)} so far`}
        </div>
        <div className="text-muted-foreground leading-none">
          {pending > 0 ? `${formatLKR(pending)} more waiting for review` : "Nothing waiting for review"}
        </div>
        {action}
      </CardFooter>
    </Card>
  );
}
