"use client";

import { CheckCircle2Icon, PrinterIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/core/format";
import { monthLabel, shiftMonth, todayISO } from "@/lib/core/month";
import type { TuteClassNeed, TuteForecastMethod, TuteStockRow } from "@/lib/supabase/database.types";
import type { TuteForecastCheck } from "@/lib/tutes/queries";

export const METHOD_LABEL: Record<TuteForecastMethod, string> = {
  last_month: "same as last month",
  avg3: "3-month average",
  smooth: "smoothed average",
  trend: "trend",
  start_rule: "pay-again rate + new students",
  none: "no paid lists yet",
};

const left = (r: TuteStockRow) => Math.max(r.need_this - r.given_this, 0);

/** "Theory ~102 (60 Online + 42 Hall)" — a guess shows its range. */
export function classNeed(c: TuteClassNeed): string {
  const paced = c.pace !== null && c.paid !== null && c.expected === c.pace && c.pace > c.paid;
  const n = c.uploaded && !paced ? `${c.expected}` : `~${c.expected}`;
  const range = !c.uploaded && c.high > c.low ? `, ${c.low}–${c.high}` : "";
  const sofar = paced ? `, ${c.paid} paid so far at the usual pace` : "";
  return `${c.name} ${n} (${c.online} Online + ${c.expected - c.online} Hall${range}${sofar})`;
}

/** The sum behind "print N", in plain words. */
export function printReason(r: TuteStockRow, month: string): string {
  const parts: string[] = [];
  if (left(r) > 0) parts.push(`${left(r)} still to give in ${monthLabel(month, "short")}`);
  if (r.classes_next.length > 0) {
    parts.push(`${monthLabel(shiftMonth(month, 1), "short")}: ${r.classes_next.map(classNeed).join(" + ")}`);
  }
  let sum = parts.join(" · ");
  sum += ` · +${r.safety} safety`;
  if (r.loss_extra > 0) sum += ` · +${r.loss_extra} usual loss`;
  sum += ` · −${r.on_hand} on hand`;
  if (r.in_print > 0) sum += ` · −${r.in_print} printing`;
  const short = left(r) + r.need_next + r.safety + r.loss_extra - r.on_hand - r.in_print;
  sum += ` = ${Math.max(short, 0)}`;
  if (r.print_now !== short && r.print_now > 0) sum += `, rounded up to batches of ${r.print_batch}`;
  return sum;
}

export function PrintPlan({
  rows,
  report,
  pace,
  month,
  canEdit,
  onCreateJob,
}: {
  rows: TuteStockRow[];
  report: TuteForecastCheck[];
  pace: { samples: number; needed: number };
  month: string;
  canEdit: boolean;
  onCreateJob: (row: TuteStockRow) => void;
}) {
  const today = todayISO();
  const toPrint = rows
    .filter((r) => r.print_now > 0)
    .sort((a, b) => (a.print_by ?? "").localeCompare(b.print_by ?? "") || a.name.localeCompare(b.name));
  const covered = rows.filter((r) => r.print_now === 0 && r.status !== "not_scheduled");
  const afterMonth = monthLabel(shiftMonth(month, 2), "short");

  const byClass = new Map<string, TuteForecastCheck[]>();
  for (const c of report) byClass.set(c.className, [...(byClass.get(c.className) ?? []), c]);

  return (
    <div className="space-y-4">
      {toPrint.length === 0 ? (
        <EmptyState
          icon={CheckCircle2Icon}
          title="Nothing to print right now"
          description={`Stock and print jobs cover ${monthLabel(month)} and ${monthLabel(shiftMonth(month, 1))}, with spare copies.`}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {toPrint.map((r) => {
            const now = r.print_by !== null && r.print_by <= today;
            return (
              <Card key={r.tute_id} className="gap-3">
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="text-base break-words">{r.name}</CardTitle>
                    <CardDescription>
                      {now ? (
                        <Badge variant="destructive">Print now</Badge>
                      ) : (
                        <>
                          Send to print by <span className="text-foreground font-medium">{formatDate(r.print_by)}</span>
                        </>
                      )}{" "}
                      · printing takes about {r.lead_days} days
                    </CardDescription>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-semibold tabular-nums">{r.print_now}</p>
                    <p className="text-muted-foreground text-xs">copies</p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground">{printReason(r, month)}</p>
                  {r.need_after > 0 && (
                    <p className="text-muted-foreground">
                      Also needed in {afterMonth}: about {r.need_after}. Printing{" "}
                      {Math.ceil((r.print_now + r.need_after) / Math.max(r.print_batch, 1)) * Math.max(r.print_batch, 1)} together saves a
                      second press run.
                    </p>
                  )}
                  {canEdit && (
                    <Button size="sm" onClick={() => onCreateJob(r)}>
                      <PrinterIcon /> Create print job
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {covered.length > 0 && (
        <p className="text-muted-foreground text-sm">
          Covered: {covered.map((r) => r.name).join(", ")}.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How close the forecast has been</CardTitle>
          <CardDescription>
            Each class&apos;s forecast for its last paid lists, worked out only from the months before, next to what was
            really paid. Each class uses whichever method has been most accurate for it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-3 text-xs">
            {pace.samples >= pace.needed
              ? "Mid-month forecast is on: an early paid list is scaled up by how far payments usually are by that day."
              : `Mid-month forecast is still learning: ${pace.samples} of ${pace.needed} past class-months with more than one upload. Upload the paid list a few times a month to teach it.`}
          </p>
          {byClass.size === 0 ? (
            <p className="text-muted-foreground text-sm">Upload at least two months of paid lists to see this.</p>
          ) : (
            <ul className="divide-y text-sm">
              {[...byClass.entries()].map(([name, checks]) => {
                const closeness =
                  checks.reduce((s, c) => s + Math.max(0, 100 - (Math.abs(c.forecast - c.actual) / Math.max(c.actual, 1)) * 100), 0) /
                  checks.length;
                return (
                  <li key={name} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{name}</p>
                      <p className="text-muted-foreground text-xs">
                        {checks.map((c) => `${monthLabel(c.month, "short")}: ~${c.forecast} vs ${c.actual}`).join(" · ")}
                        {" · "}
                        {METHOD_LABEL[checks[checks.length - 1].method]}
                      </p>
                    </div>
                    <Badge variant={closeness >= 90 ? "success" : closeness >= 75 ? "warning" : "destructive"}>
                      {Math.round(closeness)}% close
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
