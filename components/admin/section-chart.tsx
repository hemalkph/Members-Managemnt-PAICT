"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "motion/react";

export type SectionChartDatum = { section: string; approved: number; pending: number; rejected: number };

const SERIES = [
  { key: "approved", label: "Approved", color: "var(--success)" },
  { key: "pending", label: "Pending", color: "var(--warning)" },
  { key: "rejected", label: "Rejected", color: "var(--destructive)" },
] as const;

export function SectionChart({ data }: { data: SectionChartDatum[] }) {
  const reduceMotion = useReducedMotion();
  const height = Math.max(180, 70 + data.length * 52);

  return (
    <div style={{ height }} className="w-full text-xs">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }} barSize={18}>
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} stroke="var(--muted-foreground)" />
          <YAxis
            type="category"
            dataKey="section"
            width={124}
            tickLine={false}
            axisLine={false}
            stroke="var(--muted-foreground)"
            tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
          />
          <Tooltip
            cursor={{ fill: "color-mix(in oklch, var(--muted) 60%, transparent)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
            }}
          />
          <Legend iconType="circle" wrapperStyle={{ paddingTop: 8 }} />
          {SERIES.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="a"
              fill={s.color}
              isAnimationActive={!reduceMotion}
              radius={i === SERIES.length - 1 ? [0, 4, 4, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
