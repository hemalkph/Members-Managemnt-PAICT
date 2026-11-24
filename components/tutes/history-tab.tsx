"use client";

import { useMemo } from "react";
import { BookCopyIcon, DownloadIcon, HistoryIcon, SearchIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { KIND, KIND_BADGE } from "@/components/tutes/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/core/format";
import { monthLabel } from "@/lib/core/month";
import type { TuteMoveKind, TuteStockRow } from "@/lib/supabase/database.types";
import { historyToCsv } from "@/lib/tutes/helpers";
import type { TuteMove } from "@/lib/tutes/queries";
import { cn } from "@/lib/utils";

export type HistoryKindFilter = "all" | "flagged" | TuteMoveKind;

export function HistoryTab({
  moves,
  stock,
  month,
  search,
  onSearchChange,
  tuteFilter,
  onTuteFilterChange,
  kindFilter,
  onKindFilterChange,
  onClearFilters,
}: {
  moves: TuteMove[];
  stock: TuteStockRow[];
  month: string;
  search: string;
  onSearchChange: (v: string) => void;
  tuteFilter: string;
  onTuteFilterChange: (v: string) => void;
  kindFilter: HistoryKindFilter;
  onKindFilterChange: (v: HistoryKindFilter) => void;
  onClearFilters: () => void;
}) {
  const tuteOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of stock) map.set(r.tute_id, r.name);
    for (const m of moves) if (!map.has(m.tuteId)) map.set(m.tuteId, m.tuteName);
    return [...map.entries()].sort(([, a], [, b]) => a.localeCompare(b));
  }, [stock, moves]);

  const flaggedCount = useMemo(() => moves.filter((m) => Boolean(m.flag)).length, [moves]);

  const filteredMoves = useMemo(() => {
    const q = search.trim().toLowerCase();
    return moves.filter((m) => {
      if (tuteFilter !== "all" && m.tuteId !== tuteFilter) return false;
      if (kindFilter === "flagged" && !m.flag) return false;
      if (kindFilter !== "all" && kindFilter !== "flagged" && m.kind !== kindFilter) return false;
      if (
        q &&
        !m.tuteName.toLowerCase().includes(q) &&
        !(m.className ?? "").toLowerCase().includes(q) &&
        !m.note.toLowerCase().includes(q) &&
        !m.by.toLowerCase().includes(q) &&
        !KIND[m.kind].toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [moves, search, tuteFilter, kindFilter]);

  const hasFilters = search.trim() !== "" || tuteFilter !== "all" || kindFilter !== "all";

  const exportCsv = () => {
    if (filteredMoves.length === 0) return;
    const csv = historyToCsv(filteredMoves);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tute-stock-history-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (moves.length === 0) {
    return <EmptyState icon={BookCopyIcon} title="No stock changes yet" description="Count a tute to start its stock." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search history…"
              className="h-8 pr-7 pl-8 text-sm"
              aria-label="Search stock history"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label="Clear history search"
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>

          <Select value={tuteFilter} onValueChange={onTuteFilterChange}>
            <SelectTrigger className="h-8 w-[190px] text-xs" aria-label="Filter by tute">
              <SelectValue placeholder="All tutes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tutes</SelectItem>
              {tuteOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={kindFilter} onValueChange={(v) => onKindFilterChange(v as HistoryKindFilter)}>
            <SelectTrigger className="h-8 w-[160px] text-xs" aria-label="Filter by change type">
              <SelectValue placeholder="All changes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All changes</SelectItem>
              <SelectItem value="flagged">Odd / flagged</SelectItem>
              {(Object.entries(KIND) as [TuteMoveKind, string][]).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {flaggedCount > 0 && (
            <Button
              type="button"
              size="sm"
              variant={kindFilter === "flagged" ? "default" : "outline"}
              className={cn(
                "h-8 gap-1 px-2.5 text-xs",
                kindFilter !== "flagged" && "border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-warning",
              )}
              onClick={() => onKindFilterChange(kindFilter === "flagged" ? "all" : "flagged")}
            >
              <TriangleAlertIcon className="size-3.5" />
              {flaggedCount} odd / flagged
            </Button>
          )}

          {hasFilters && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onClearFilters}>
              Clear ({filteredMoves.length}/{moves.length})
            </Button>
          )}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={filteredMoves.length === 0}
          onClick={exportCsv}
        >
          <DownloadIcon className="size-3.5" /> Export CSV
        </Button>
      </div>

      {filteredMoves.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="No matching stock changes"
          description="Try clearing the tute or type filter."
          action={
            <Button size="sm" variant="outline" onClick={onClearFilters}>
              Show all changes
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop history table */}
          <Card className="hidden py-0 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Tute</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMoves.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(m.createdAt)}</TableCell>
                    <TableCell className="font-medium">{m.tuteName}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        m.qty > 0 ? "text-success" : m.kind === "damaged" ? "text-destructive" : "",
                      )}
                    >
                      {m.qty > 0 ? `+${m.qty}` : m.qty}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={KIND_BADGE[m.kind]} className="text-[11px] font-normal">
                          {KIND[m.kind]}
                        </Badge>
                        {m.className && <span className="text-muted-foreground text-xs">{m.className}</span>}
                        {m.kind === "class_issue" && m.month && (
                          <span className="text-muted-foreground text-xs">· {monthLabel(m.month.slice(0, 7), "short")}</span>
                        )}
                      </div>
                      {m.note && <p className="text-muted-foreground mt-0.5 text-xs">{m.note}</p>}
                      {m.flag && (
                        <p className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-warning">
                          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" /> {m.flag}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{m.by}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile history cards */}
          <Card className="divide-y py-0 md:hidden">
            {filteredMoves.map((m) => (
              <div key={m.id} className="space-y-1.5 px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium break-words">{m.tuteName}</p>
                  <span
                    className={cn(
                      "shrink-0 font-semibold tabular-nums",
                      m.qty > 0 ? "text-success" : m.kind === "damaged" ? "text-destructive" : "",
                    )}
                  >
                    {m.qty > 0 ? `+${m.qty}` : m.qty}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={KIND_BADGE[m.kind]} className="text-[10px] font-normal">
                    {KIND[m.kind]}
                  </Badge>
                  {m.className && <span className="text-muted-foreground text-xs">{m.className}</span>}
                  {m.kind === "class_issue" && m.month && (
                    <span className="text-muted-foreground text-xs">· {monthLabel(m.month.slice(0, 7), "short")}</span>
                  )}
                </div>
                {m.note && <p className="text-muted-foreground text-xs">{m.note}</p>}
                {m.flag && (
                  <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-warning">
                    <TriangleAlertIcon className="mt-px size-3.5 shrink-0" /> {m.flag}
                  </p>
                )}
                <p className="text-muted-foreground text-[11px]">
                  {m.by} · {formatDateTime(m.createdAt)}
                </p>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
