"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowDownIcon, ArrowUpIcon, BookCopyIcon, BookOpenIcon, CalendarPlusIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { attachClassMonthTuteAction, removeClassMonthTuteAction, reorderClassMonthTutesAction } from "@/lib/actions/fees";
import { monthLabel, shiftMonth } from "@/lib/core/month";
import type { ClassTuteCatalogItem, ScheduledMonthTute } from "@/lib/fees/queries";

function buildPlanMonths(baseMonth: string, existingMonths: string[]): string[] {
  const set = new Set<string>(existingMonths);
  // 6 months back through 12 future months ahead so staff can pre-plan upcoming tutes.
  for (let d = -6; d <= 12; d++) {
    set.add(shiftMonth(baseMonth, d));
  }
  return [...set].sort();
}

export function TutesManager({
  classId,
  className,
  defaultMonth,
  catalog,
  scheduled,
  stock,
  canEdit,
}: {
  classId: string;
  className: string;
  defaultMonth: string;
  catalog: ClassTuteCatalogItem[];
  scheduled: ScheduledMonthTute[];
  stock: Record<string, { onHand: number; inPrint: number }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [prevDefaultKey, setPrevDefaultKey] = useState(`${classId}|${defaultMonth}`);
  const defaultKey = `${classId}|${defaultMonth}`;
  if (defaultKey !== prevDefaultKey) {
    setPrevDefaultKey(defaultKey);
    setSelectedMonth(defaultMonth);
  }

  // Attach existing catalog tute
  const [attachTuteId, setAttachTuteId] = useState("");

  const [pending, startTransition] = useTransition();

  // Months that already have tutes scheduled for this class, with counts.
  const scheduledMonthsSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of scheduled) {
      counts.set(s.month, (counts.get(s.month) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [scheduled]);

  const monthOptions = useMemo(
    () =>
      buildPlanMonths(
        defaultMonth,
        scheduledMonthsSummary.map(([m]) => m),
      ),
    [defaultMonth, scheduledMonthsSummary],
  );

  const monthTutes = useMemo(
    () => scheduled.filter((s) => s.month === selectedMonth).sort((a, b) => a.sortOrder - b.sortOrder),
    [scheduled, selectedMonth],
  );

  const attachedTuteIds = useMemo(() => new Set(monthTutes.map((t) => t.tuteId)), [monthTutes]);

  const attachableCatalog = useMemo(
    () => catalog.filter((t) => t.isActive && !attachedTuteIds.has(t.id)),
    [catalog, attachedTuteIds],
  );

  // Count how many months each catalog tute is scheduled in (for the catalog view).
  const monthCountByTuteId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of scheduled) {
      const list = map.get(s.tuteId) ?? [];
      list.push(s.month);
      map.set(s.tuteId, list);
    }
    return map;
  }, [scheduled]);

  const handleAttach = () => {
    if (!attachTuteId) return;
    startTransition(async () => {
      const res = await attachClassMonthTuteAction({
        class_id: classId,
        month: selectedMonth,
        tute_id: attachTuteId,
        note: "",
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setAttachTuteId("");
      router.refresh();
    });
  };

  const handleRemoveFromMonth = (linkId: string) => {
    startTransition(async () => {
      const res = await removeClassMonthTuteAction(linkId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  };

  const handleMove = (idx: number, delta: -1 | 1) => {
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= monthTutes.length) return;
    const ids = monthTutes.map((t) => t.id);
    [ids[idx], ids[targetIdx]] = [ids[targetIdx], ids[idx]];
    startTransition(async () => {
      const res = await reorderClassMonthTutesAction({
        class_id: classId,
        month: selectedMonth,
        ids,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  };

  const isFutureMonth = selectedMonth > defaultMonth;

  return (
    <div className="space-y-4">
      {/* Month selector + scheduled months strip */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpenIcon className="size-4 text-primary" />
                Monthly &amp; Future Tutes — {className}
              </CardTitle>
              <CardDescription>
                Add different tutes for each month — including upcoming future months. Scheduled tutes automatically
                fill <code className="text-[11px]">{"{tutes}"}</code> and{" "}
                <code className="text-[11px]">{"{tutes_list}"}</code> in WhatsApp reminders, and Tute stock uses them to
                work out how many copies each month needs.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="tute-month-select" className="text-xs whitespace-nowrap">
                Schedule month
              </Label>
              <Select
                value={selectedMonth}
                onValueChange={setSelectedMonth}
              >
                <SelectTrigger id="tute-month-select" className="h-8 w-[175px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {monthLabel(m)}
                      {m === defaultMonth ? " (active)" : m > defaultMonth ? " (future)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        {scheduledMonthsSummary.length > 0 && (
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground mr-1 text-xs">Scheduled months:</span>
              {scheduledMonthsSummary.map(([m, count]) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={selectedMonth === m ? "default" : "outline"}
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setSelectedMonth(m)}
                >
                  {monthLabel(m, "short")}
                  <Badge
                    variant={selectedMonth === m ? "secondary" : "outline"}
                    className="px-1 text-[10px] tabular-nums"
                  >
                    {count}
                  </Badge>
                </Button>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        {/* Left: Scheduled tutes for the chosen month */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                {monthLabel(selectedMonth)} Tutes ({monthTutes.length})
                {isFutureMonth && <Badge variant="secondary">Future month</Badge>}
              </CardTitle>
            </div>
            <CardDescription>
              Order here controls the exact order shown in <code className="text-[11px]">{"{tutes_list}"}</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {monthTutes.length === 0 ? (
              <div className="bg-muted/35 rounded-xl border border-dashed p-6 text-center">
                <p className="text-sm font-medium">No tutes scheduled for {monthLabel(selectedMonth)} yet</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Pick a tute on the right, or create one on Tute stock.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {monthTutes.map((item, idx) => {
                  return (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span aria-hidden="true">📘</span>
                          <span className="font-medium break-words">{item.tuteName}</span>
                          {item.tuteCode && (
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {item.tuteCode}
                            </Badge>
                          )}
                          {stock[item.tuteId] && (
                            <Badge variant="secondary" className="text-[10px] tabular-nums">
                              {stock[item.tuteId].onHand} in stock
                              {stock[item.tuteId].inPrint > 0 && ` · ${stock[item.tuteId].inPrint} printing`}
                            </Badge>
                          )}
                        </div>
                        {item.note && <p className="text-muted-foreground pl-6 text-xs">{item.note}</p>}
                      </div>

                      {canEdit && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Move ${item.tuteName} up`}
                            disabled={pending || idx === 0}
                            onClick={() => handleMove(idx, -1)}
                          >
                            <ArrowUpIcon className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Move ${item.tuteName} down`}
                            disabled={pending || idx === monthTutes.length - 1}
                            onClick={() => handleMove(idx, 1)}
                          >
                            <ArrowDownIcon className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive size-7"
                            aria-label={`Remove ${item.tuteName} from ${monthLabel(selectedMonth)}`}
                            title={`Remove from ${monthLabel(selectedMonth)} (keeps in catalog)`}
                            disabled={pending}
                            onClick={() => handleRemoveFromMonth(item.id)}
                          >
                            <XIcon className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Live placeholder preview */}
            {monthTutes.length > 0 && (
              <div className="bg-muted/40 space-y-1.5 rounded-lg border p-3 text-xs">
                <p className="font-semibold">
                  How <code className="font-mono">{"{tutes_list}"}</code> renders in WhatsApp:
                </p>
                <pre className="font-sans leading-relaxed whitespace-pre-wrap">
                  {monthTutes.map((t) => `📘 ${t.tuteName}`).join("\n")}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: pick tutes from the batch catalog (tutes are created on Tute stock) */}
        {canEdit && (
          <Card className="h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarPlusIcon className="size-4" /> Add a tute to {monthLabel(selectedMonth, "short")}
              </CardTitle>
              <CardDescription>
                Pick tutes one by one. They show in <code className="text-[11px]">{"{tutes_list}"}</code> in the
                order on the left. New tutes are created on Tute stock.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {attachableCatalog.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <Select value={attachTuteId} onValueChange={setAttachTuteId}>
                    <SelectTrigger className="h-8 min-w-[200px] flex-1 text-xs">
                      <SelectValue placeholder="Choose a tute..." />
                    </SelectTrigger>
                    <SelectContent>
                      {attachableCatalog.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.code ? `[${t.code}] ` : ""}
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" disabled={pending || !attachTuteId} onClick={handleAttach}>
                    {pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Add
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {catalog.some((t) => t.isActive)
                    ? `Every tute is already in ${monthLabel(selectedMonth, "short")}.`
                    : "No tutes on the shelf yet."}
                </p>
              )}
              <Button asChild size="sm" variant="outline" className="w-full">
                <Link href="/admin/tutes">
                  <BookCopyIcon /> Create or edit tutes on Tute stock
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Batch tute catalog */}
      {catalog.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Tute shelf ({catalog.length})
            </CardTitle>
            <CardDescription>
              Tutes of this batch. Add, rename or archive them on Tute stock.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.map((t) => {
                const usedMonths = monthCountByTuteId.get(t.id) ?? [];
                return (
                  <div
                    key={t.id}
                    className="flex items-start justify-between gap-2 rounded-lg border p-2.5 text-sm"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium break-words">
                        {t.name}{" "}
                        {t.code && (
                          <Badge variant="outline" className="ml-1 font-mono text-[10px]">
                            {t.code}
                          </Badge>
                        )}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {usedMonths.length > 0
                          ? `In ${className}: ${usedMonths.map((m) => monthLabel(m, "short")).join(", ")}`
                          : `Not scheduled in ${className} yet`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
