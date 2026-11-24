"use client";

import { useState } from "react";
import { CheckCircle2Icon, CheckIcon, ChevronDownIcon, CopyIcon, PrinterIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatDate } from "@/lib/core/format";
import { monthLabel, shiftMonth, todayISO } from "@/lib/core/month";
import type { TuteClassNeed, TuteStockRow } from "@/lib/supabase/database.types";
import { METHOD_LABEL, formatPressOrderText, leftThisMonth } from "@/lib/tutes/helpers";
import type { TuteForecastCheck } from "@/lib/tutes/queries";
import { cn } from "@/lib/utils";

/** "Theory ~102 (60 Online + 42 Hall)" — a guess shows its range. */
export function classNeed(c: TuteClassNeed): string {
  const paced = c.pace !== null && c.paid !== null && c.expected === c.pace && c.pace > c.paid;
  const n = c.uploaded && !paced ? `${c.expected}` : `~${c.expected}`;
  const range = !c.uploaded && c.high > c.low ? `, ${c.low}–${c.high}` : "";
  const sofar = paced ? `, ${c.paid} paid so far at the usual pace` : "";
  return `${c.name} ${n} (${c.online} Online + ${c.expected - c.online} Hall${range}${sofar})`;
}

/** The sum behind "print N", in plain words (used in compact dialog hints). */
export function printReason(r: TuteStockRow, month: string): string {
  const parts: string[] = [];
  if (leftThisMonth(r) > 0) parts.push(`${leftThisMonth(r)} still to give in ${monthLabel(month, "short")}`);
  if (r.classes_next.length > 0) {
    parts.push(`${monthLabel(shiftMonth(month, 1), "short")}: ${r.classes_next.map(classNeed).join(" + ")}`);
  }
  let sum = parts.join(" · ");
  sum += ` · +${r.safety} safety`;
  if (r.loss_extra > 0) sum += ` · +${r.loss_extra} usual loss`;
  sum += ` · −${r.on_hand} on hand`;
  if (r.in_print > 0) sum += ` · −${r.in_print} printing`;
  const short = leftThisMonth(r) + r.need_next + r.safety + r.loss_extra - r.on_hand - r.in_print;
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
  onCreateJob: (row: TuteStockRow, suggestedQty?: number) => void;
}) {
  const today = todayISO();
  const toPrint = rows
    .filter((r) => r.print_now > 0)
    .sort((a, b) => (a.print_by ?? "").localeCompare(b.print_by ?? "") || a.name.localeCompare(b.name));
  const covered = rows.filter((r) => r.print_now === 0 && r.status !== "not_scheduled" && r.status !== "not_counted");
  const nextMonthLabel = monthLabel(shiftMonth(month, 1), "short");
  const afterMonth = monthLabel(shiftMonth(month, 2), "short");

  const [copied, setCopied] = useState(false);
  const [coveredOpen, setCoveredOpen] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(toPrint.length === 0);

  const urgentCount = toPrint.filter((r) => r.print_by !== null && r.print_by <= today).length;
  const totalCopies = toPrint.reduce((sum, r) => sum + r.print_now, 0);

  const byClass = new Map<string, TuteForecastCheck[]>();
  for (const c of report) byClass.set(c.className, [...(byClass.get(c.className) ?? []), c]);

  const avgCloseness =
    report.length > 0
      ? Math.round(
          report.reduce((s, c) => s + Math.max(0, 100 - (Math.abs(c.forecast - c.actual) / Math.max(c.actual, 1)) * 100), 0) /
            report.length,
        )
      : null;

  const copyPressOrder = async () => {
    const orderText = formatPressOrderText(toPrint, month, today);
    if (!orderText) return;
    try {
      await navigator.clipboard.writeText(orderText);
      setCopied(true);
      toast.success("Print order copied — ready to paste into WhatsApp");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <div className="space-y-4">
      {toPrint.length === 0 ? (
        <EmptyState
          icon={CheckCircle2Icon}
          title="Nothing to print right now"
          description={`Stock and print jobs cover ${monthLabel(month)} and ${monthLabel(shiftMonth(month, 1))}, with spare copies.`}
        />
      ) : (
        <>
          {/* Summary bar + Copy press order */}
          <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border px-4 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium tabular-nums">
                {toPrint.length} tute{toPrint.length === 1 ? "" : "s"} to print · {totalCopies} copies total
              </span>
              {urgentCount > 0 && (
                <Badge variant="destructive" className="tabular-nums">
                  {urgentCount} urgent
                </Badge>
              )}
            </div>
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={copyPressOrder}>
              {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
              {copied ? "Copied for press" : "Copy order for press"}
            </Button>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {toPrint.map((r) => {
              const now = r.print_by !== null && r.print_by <= today;
              const batch = Math.max(r.print_batch, 1);
              const combinedQty = r.need_after > 0 ? Math.ceil((r.print_now + r.need_after) / batch) * batch : 0;
              const stillThis = leftThisMonth(r);
              const rawShort = Math.max(stillThis + r.need_next + r.safety + r.loss_extra - r.on_hand - r.in_print, 0);
              return (
                <Card key={r.tute_id} className="gap-3">
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CardTitle className="text-base break-words">{r.name}</CardTitle>
                        {r.code && (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {r.code}
                          </Badge>
                        )}
                      </div>
                      <CardDescription>
                        {now ? (
                          <Badge variant="destructive">Print now</Badge>
                        ) : (
                          <>
                            Send to print by <span className="text-foreground font-medium">{formatDate(r.print_by)}</span>
                          </>
                        )}{" "}
                        · ~{r.lead_days} days at printer
                      </CardDescription>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-2xl leading-none font-semibold tabular-nums">{r.print_now}</p>
                      <p className="text-muted-foreground mt-0.5 text-xs">copies</p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {/* Scannable 3-part math breakdown */}
                    <div className="bg-muted/35 space-y-2 rounded-lg border p-3 text-xs">
                      <div className="space-y-1">
                        <p className="text-muted-foreground font-medium tracking-wide uppercase text-[10px]">Need</p>
                        {stillThis > 0 && (
                          <p>
                            <span className="font-medium tabular-nums">{stillThis}</span> still to give in{" "}
                            {monthLabel(month, "short")}
                          </p>
                        )}
                        {r.classes_next.map((c) => {
                          const hall = Math.max(c.expected - c.online, 0);
                          const paced = c.pace !== null && c.paid !== null && c.expected === c.pace && c.pace > c.paid;
                          const countLabel = c.uploaded && !paced ? `${c.expected}` : `~${c.expected}`;
                          return (
                            <div key={c.id} className="flex flex-wrap items-center gap-1.5">
                              <span>
                                {nextMonthLabel} · <span className="font-medium">{c.name}</span>{" "}
                                <span className="font-semibold tabular-nums">{countLabel}</span>
                              </span>
                              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal tabular-nums">
                                {c.online} Online
                              </Badge>
                              <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal tabular-nums">
                                {hall} Hall
                              </Badge>
                              {!c.uploaded && c.high > c.low && (
                                <span className="text-muted-foreground tabular-nums">({c.low}–{c.high})</span>
                              )}
                              {paced && c.paid !== null && (
                                <span className="text-muted-foreground tabular-nums">({c.paid} paid so far)</span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 tabular-nums">
                        <span>+{r.safety} safety</span>
                        {r.loss_extra > 0 && <span>+{r.loss_extra} usual loss</span>}
                        <span>−{r.on_hand} on hand</span>
                        {r.in_print > 0 && <span>−{r.in_print} printing</span>}
                        <span className="text-foreground font-medium">
                          = {rawShort}
                          {r.print_now !== rawShort ? ` → ${r.print_now} (batches of ${r.print_batch})` : ""}
                        </span>
                      </div>
                    </div>

                    {r.need_after > 0 && (
                      <p className="text-muted-foreground text-xs">
                        Also needed in {afterMonth}: about <span className="text-foreground font-medium">{r.need_after}</span>.
                        Printing <span className="text-foreground font-medium">{combinedQty}</span> together saves a second
                        press run.
                      </p>
                    )}

                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => onCreateJob(r)}>
                          <PrinterIcon /> Create print job ({r.print_now})
                        </Button>
                        {combinedQty > r.print_now && (
                          <Button size="sm" variant="outline" onClick={() => onCreateJob(r, combinedQty)}>
                            Create combined job ({combinedQty})
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Collapsible Covered tutes strip */}
      {covered.length > 0 && (
        <Collapsible open={coveredOpen} onOpenChange={setCoveredOpen}>
          <Card className="gap-0 py-0">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="hover:bg-muted/40 flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition-colors"
              >
                <span className="flex items-center gap-2 font-medium">
                  <CheckCircle2Icon className="text-success size-4 shrink-0" />
                  Covered ({covered.length} tute{covered.length === 1 ? "" : "s"})
                </span>
                <ChevronDownIcon className={cn("text-muted-foreground size-4 transition-transform", coveredOpen && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-wrap gap-1.5 border-t px-4 py-3">
                {covered.map((r) => (
                  <Badge key={r.tute_id} variant="outline" className="gap-1 font-normal">
                    <CheckIcon className="text-success size-3" />
                    {r.name}
                    <span className="text-muted-foreground tabular-nums">({r.on_hand + r.in_print})</span>
                  </Badge>
                ))}
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Collapsible Forecast Report Card */}
      <Collapsible open={forecastOpen} onOpenChange={setForecastOpen}>
        <Card className="gap-0 py-0">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">How close the forecast has been</span>
                  {avgCloseness !== null && (
                    <Badge
                      variant={avgCloseness >= 90 ? "success" : avgCloseness >= 75 ? "warning" : "destructive"}
                      className="text-[11px] tabular-nums"
                    >
                      {avgCloseness}% avg
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {pace.samples >= pace.needed
                    ? "Mid-month pace forecast is active."
                    : `Mid-month forecast learning: ${pace.samples} of ${pace.needed} class-months.`}
                </p>
              </div>
              <ChevronDownIcon className={cn("text-muted-foreground size-4 shrink-0 transition-transform", forecastOpen && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="border-t pt-4 pb-4">
              <p className="text-muted-foreground mb-3 text-xs">
                Each class&apos;s forecast for its last paid lists, worked out only from the months before, next to what was
                really paid. Each class uses whichever method has been most accurate for it.
              </p>
              {byClass.size === 0 ? (
                <p className="text-muted-foreground text-sm">Upload at least two months of paid lists to see this.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {[...byClass.entries()].map(([name, checks]) => {
                    const closeness =
                      checks.reduce(
                        (s, c) => s + Math.max(0, 100 - (Math.abs(c.forecast - c.actual) / Math.max(c.actual, 1)) * 100),
                        0,
                      ) / checks.length;
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
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
