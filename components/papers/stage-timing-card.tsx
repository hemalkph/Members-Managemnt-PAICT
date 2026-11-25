"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { applyOffsetSuggestionAction } from "@/lib/actions/paper-offsets";
import { PRE_EXAM_STAGES, STAGE_LABEL } from "@/lib/papers";
import type { OffsetSuggestion, StageStat } from "@/lib/papers/countdown";

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** How long each stage really takes, and "start it earlier" suggestions admins can apply. */
export function StageTimingCard({
  stats,
  suggestions,
  canApply,
}: {
  stats: StageStat[];
  suggestions: OffsetSuggestion[];
  canApply: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const rows = stats.filter((s) => PRE_EXAM_STAGES.includes(s.stage));

  const apply = (s: OffsetSuggestion) => {
    setBusy(s.stage);
    startTransition(async () => {
      const res = await applyOffsetSuggestionAction({ stage: s.stage, start: s.next.start, due: s.next.due });
      setBusy(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage timing</CardTitle>
        <CardDescription>
          From finished papers. Suggestions change only new papers, never ones already planned.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {suggestions.length > 0 && (
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li
                key={s.stage}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium">{s.label}</span> is late {s.latePct}% of the time, by {s.avgDaysLate}{" "}
                  days on average. Start it {days(s.earlierBy)} earlier?
                </span>
                {canApply && (
                  <Button size="sm" variant="outline" disabled={busy === s.stage} onClick={() => apply(s)}>
                    {busy === s.stage && <Loader2Icon className="animate-spin" />}
                    Apply
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No finished stages yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Done</TableHead>
                <TableHead className="text-right">Late</TableHead>
                <TableHead className="text-right">Avg late</TableHead>
                <TableHead className="text-right">Typical</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.stage}>
                  <TableCell>{STAGE_LABEL[s.stage]}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.done}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Math.round((s.late / Math.max(s.done, 1)) * 100)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.late > 0 ? days(s.avgDaysLate) : "–"}</TableCell>
                  <TableCell className="text-right tabular-nums">{days(s.medianDays)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
