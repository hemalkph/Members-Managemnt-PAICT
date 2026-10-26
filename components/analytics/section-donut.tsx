"use client";

import { Label, Pie, PieChart } from "recharts";
import { useReducedMotion } from "motion/react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatLKR, formatLKRCompact } from "@/lib/format";

/** Pie Chart – Donut with Text: this month's spending split by section. */
export function SectionDonut({
  data,
  monthLabel,
}: {
  data: { key: string; section: string; spent: number; fill: string }[];
  monthLabel: string;
}) {
  const reduceMotion = useReducedMotion();
  const total = data.reduce((sum, d) => sum + d.spent, 0);
  const chartConfig: ChartConfig = {
    spent: { label: "Spent" },
    ...Object.fromEntries(data.map((d) => [d.key, { label: d.section, color: d.fill }])),
  };
  const chartData = total > 0 ? data.filter((d) => d.spent > 0) : [{ key: "none", section: "No spending", spent: 1, fill: "var(--muted)" }];
  const top = [...data].sort((a, b) => b.spent - a.spent)[0];

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-0 text-center">
        <CardTitle>Spending by section</CardTitle>
        <CardDescription>{monthLabel}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[260px]">
          <PieChart>
            {total > 0 && (
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="key" valueFormatter={formatLKR} />} />
            )}
            <Pie
              data={chartData}
              dataKey="spent"
              nameKey="key"
              innerRadius={62}
              strokeWidth={5}
              isAnimationActive={!reduceMotion}
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                        <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-bold">
                          {formatLKRCompact(total)}
                        </tspan>
                        <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 22} className="fill-muted-foreground">
                          Spent
                        </tspan>
                      </text>
                    );
                  }
                  return null;
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col gap-2 text-center text-sm">
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
          {data.map((d) => (
            <span key={d.key} className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
              <span className="size-2 rounded-[2px]" style={{ background: d.fill }} />
              {d.section}
            </span>
          ))}
        </div>
        <div className="text-muted-foreground leading-none">
          {total > 0 && top ? `Most spent: ${top.section} (${formatLKR(top.spent)})` : "No approved paid work yet this month"}
        </div>
      </CardFooter>
    </Card>
  );
}
