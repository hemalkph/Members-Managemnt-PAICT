"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookCopyIcon,
  ChevronDownIcon,
  ClipboardCheckIcon,
  EllipsisVerticalIcon,
  HandIcon,
  Loader2Icon,
  PackageCheckIcon,
  PlusIcon,
  PrinterIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { BOOKLET_KIND_META, BookletEmblem, SupplyGauge, VERDICT_TEXT_CLASS } from "@/components/tutes/booklet-emblem";
import type { DialogState, StockFilter } from "@/components/tutes/shared";
import { TuteInspector } from "@/components/tutes/tute-inspector";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { monthLabel } from "@/lib/core/month";
import type { TuteStockRow } from "@/lib/supabase/database.types";
import { inferTuteKind, leftThisMonth, shelfVerdict } from "@/lib/tutes/helpers";
import type { TuteMove, TutePrintJob } from "@/lib/tutes/queries";
import { cn } from "@/lib/utils";

const FILTER_LABELS: Partial<Record<StockFilter, string>> = {
  out: "Out of stock",
  low: "Running low",
  action: "Low & Out",
  not_counted: "Uncounted",
  scheduled: "Scheduled",
  printing: "At press",
  ok: "Ready",
};

export function StockTab({
  rows,
  moves,
  coverUrls,
  archivedCount,
  showArchived,
  onToggleArchived,
  filter,
  onFilterChange,
  openJobsByTute,
  reserved,
  month,
  nextMonth,
  canEdit,
  pending,
  uploadingCoverId,
  onInlineCount,
  onUploadCover,
  onRemoveCover,
  onOpenDialog,
  onOpenBulk,
  onOpenReceive,
  onOpenHistory,
  onDelete,
}: {
  rows: TuteStockRow[];
  moves: TuteMove[];
  coverUrls: Record<string, string | null>;
  archivedCount: number;
  showArchived: boolean;
  onToggleArchived: () => void;
  filter: StockFilter;
  onFilterChange: (next: StockFilter) => void;
  openJobsByTute: Map<string, TutePrintJob[]>;
  reserved: Record<string, number>;
  month: string;
  nextMonth: string;
  canEdit: boolean;
  pending: boolean;
  uploadingCoverId: string | null;
  onInlineCount: (tuteId: string, counted: number) => void;
  onUploadCover: (tuteId: string, file: File) => void;
  onRemoveCover: (tuteId: string) => void;
  onOpenDialog: (state: DialogState) => void;
  onOpenBulk: (kind: "count" | "handout") => void;
  onOpenReceive: (tuteId: string) => void;
  onOpenHistory: (tuteId: string) => void;
  onDelete: (row: TuteStockRow) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(() => rows[0]?.tute_id ?? null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "out" && r.status !== "out") return false;
      if (filter === "low" && r.status !== "low") return false;
      if (filter === "action" && r.status !== "out" && r.status !== "low") return false;
      if (filter === "not_counted" && r.status !== "not_counted") return false;
      if (filter === "scheduled" && r.need_this === 0) return false;
      if (filter === "printing" && r.in_print === 0) return false;
      if (filter === "ok" && r.status !== "ok") return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, filter]);

  const hasFilters = search.trim() !== "" || filter !== "all";
  const notCountedCount = rows.filter((r) => r.status === "not_counted").length;

  // Group into real-world urgency sections so problems and uncounted shelves jump out immediately.
  const urgentRows = useMemo(
    () => visibleRows.filter((r) => r.status === "out" || r.status === "low"),
    [visibleRows],
  );
  const uncountedRows = useMemo(() => visibleRows.filter((r) => r.status === "not_counted"), [visibleRows]);
  const readyRows = useMemo(() => visibleRows.filter((r) => r.status === "ok"), [visibleRows]);
  const unscheduledRows = useMemo(() => visibleRows.filter((r) => r.status === "not_scheduled"), [visibleRows]);

  const hasActiveGroups = urgentRows.length > 0 || uncountedRows.length > 0 || readyRows.length > 0;
  const collapseUnscheduled = !hasFilters && hasActiveGroups && unscheduledRows.length > 0;

  // Ordered flat list for keyboard arrow navigation (matches visual band order).
  const orderedIds = useMemo(
    () =>
      [
        ...urgentRows,
        ...uncountedRows,
        ...readyRows,
        ...(!collapseUnscheduled || unscheduledOpen ? unscheduledRows : []),
      ].map((r) => r.tute_id),
    [urgentRows, uncountedRows, readyRows, unscheduledRows, collapseUnscheduled, unscheduledOpen],
  );

  // Resolve active inspected booklet safely even after filter changes or deletions.
  const activeRow = useMemo(() => {
    if (selectedId) {
      const exact = visibleRows.find((r) => r.tute_id === selectedId) ?? rows.find((r) => r.tute_id === selectedId);
      if (exact) return exact;
    }
    return visibleRows[0] ?? rows[0] ?? null;
  }, [selectedId, visibleRows, rows]);

  // Arrow-key navigation between booklets when focus is outside form inputs.
  useEffect(() => {
    if (orderedIds.length < 2) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const currentIdx = activeRow ? orderedIds.indexOf(activeRow.tute_id) : -1;
      const nextIdx =
        e.key === "ArrowDown"
          ? currentIdx < orderedIds.length - 1
            ? currentIdx + 1
            : 0
          : currentIdx > 0
            ? currentIdx - 1
            : orderedIds.length - 1;
      e.preventDefault();
      setSelectedId(orderedIds[nextIdx]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [orderedIds, activeRow]);

  const handleSelectRow = (row: TuteStockRow) => {
    setSelectedId(row.tute_id);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setMobileSheetOpen(true);
    }
  };

  const renderGroup = (
    title: string,
    dotClass: string,
    items: TuteStockRow[],
    rightSlot?: React.ReactNode,
  ) => (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", dotClass)} />
          <h3 className="text-xs font-semibold">{title}</h3>
          <span className="text-muted-foreground text-xs tabular-nums">{items.length}</span>
        </div>
        {rightSlot}
      </div>
      <div className="bg-card overflow-hidden rounded-xl border">
        {/* Column headings (wide screens), same widths as ShelfRow. */}
        <div className="text-muted-foreground hidden items-center gap-3 border-b px-4 py-1.5 text-[11px] font-medium @xl:flex">
          <div className="flex flex-1 items-center gap-3.5">
            <span className="flex-1">Tute</span>
            <span className="w-24">Code</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-[180px] text-right">Stock</span>
            {canEdit && <span className="w-[162px]" />}
          </div>
        </div>
        {items.map((r) => (
          <ShelfRow
            key={r.tute_id}
            row={r}
            coverUrl={coverUrls[r.tute_id] ?? null}
            selected={activeRow?.tute_id === r.tute_id}
            held={reserved[r.tute_id] ?? 0}
            hasOpenJob={(openJobsByTute.get(r.tute_id) ?? []).length > 0}
            canEdit={canEdit}
            pending={pending}
            onSelect={() => handleSelectRow(r)}
            onInlineCount={(val) => onInlineCount(r.tute_id, val)}
            onReceive={() => onOpenReceive(r.tute_id)}
            onGive={() => onOpenDialog({ kind: "issue", row: r })}
            onCount={() => onOpenDialog({ kind: "count", row: r })}
            onNewJob={() => onOpenDialog({ kind: "job", row: r })}
            onDamaged={() => onOpenDialog({ kind: "damaged", row: r })}
            onEdit={() => onOpenDialog({ kind: "tute", row: r })}
            onHistory={() => onOpenHistory(r.tute_id)}
            onDelete={() => onDelete(r)}
          />
        ))}
      </div>
    </section>
  );

  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <InputGroup className="h-8 min-w-[210px] flex-1 sm:max-w-xs">
              <InputGroupAddon align="inline-start">
                <SearchIcon className="size-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title or code…"
                aria-label="Search tutes"
                className="h-8 text-sm"
              />
              {search && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Clear search"
                    onClick={() => setSearch("")}
                  >
                    <XIcon className="size-3.5" />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>

            {filter !== "all" && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 gap-1.5 text-xs"
                onClick={() => onFilterChange("all")}
              >
                <span>{FILTER_LABELS[filter] ?? filter}</span>
                <XIcon className="size-3" />
              </Button>
            )}
          </div>

          {(canEdit || archivedCount > 0) && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {archivedCount > 0 && (
                <Button size="sm" variant="ghost" onClick={onToggleArchived}>
                  {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
                </Button>
              )}
              {canEdit && (
                <>
                  {/* Only show Count all in toolbar when uncounted band isn't already presenting it */}
                  {notCountedCount === 0 && (
                    <Button size="sm" variant="outline" onClick={() => onOpenBulk("count")}>
                      <ClipboardCheckIcon /> Count all
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => onOpenBulk("handout")}>
                    <HandIcon /> Hand out
                  </Button>
                  <Button size="sm" onClick={() => onOpenDialog({ kind: "tute", row: null })}>
                    <PlusIcon /> New tute
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={BookCopyIcon}
          title="No tutes in this batch yet"
          description="Add the batch's tutes here with their opening stock, then schedule them for each class and month."
          action={
            canEdit ? (
              <Button onClick={() => onOpenDialog({ kind: "tute", row: null })}>
                <PlusIcon /> New tute
              </Button>
            ) : undefined
          }
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title="No matching tutes"
          description="Try another name or clear the active filter."
          action={
            hasFilters ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSearch("");
                  onFilterChange("all");
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          {/* LEFT: Container-query-aware Printroom Shelf Index */}
          <div className="@container min-w-0 space-y-5">
            {urgentRows.length > 0 && renderGroup("Needs print or restock", "bg-destructive", urgentRows)}

            {uncountedRows.length > 0 &&
              renderGroup(
                "Waiting for shelf count",
                "bg-muted-foreground/60",
                uncountedRows,
                canEdit ? (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground hidden items-center gap-1 text-xs @md:inline-flex">
                      Type count &amp; press <Kbd>↵</Kbd>
                    </span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onOpenBulk("count")}>
                      <ClipboardCheckIcon className="size-3.5" /> Count all
                    </Button>
                  </div>
                ) : undefined,
              )}

            {readyRows.length > 0 && renderGroup("Ready on shelf", "bg-success", readyRows)}

            {unscheduledRows.length > 0 &&
              (collapseUnscheduled ? (
                <Collapsible open={unscheduledOpen} onOpenChange={setUnscheduledOpen} className="space-y-2.5">
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground h-9 w-full justify-between border border-dashed px-3 text-xs"
                    >
                      <span>
                        Not scheduled for {monthLabel(month, "short")} or {monthLabel(nextMonth, "short")} (
                        {unscheduledRows.length})
                      </span>
                      <ChevronDownIcon className={cn("size-4 transition-transform", unscheduledOpen && "rotate-180")} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {renderGroup("Not scheduled", "bg-border", unscheduledRows)}
                  </CollapsibleContent>
                </Collapsible>
              ) : (
                renderGroup("Not scheduled", "bg-border", unscheduledRows)
              ))}

            <p className="text-muted-foreground px-1 text-xs">
              Click any booklet to inspect its Hall vs Speed Post class breakdown and recent history. Use{" "}
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> to step through the shelf.
            </p>
          </div>

          {/* RIGHT: Sticky Master-Detail Tute Inspector (desktop) */}
          <aside className="bg-card hidden overflow-hidden rounded-xl border lg:sticky lg:top-4 lg:block">
            <TuteInspector
              row={activeRow}
              moves={moves}
              openJobs={activeRow ? (openJobsByTute.get(activeRow.tute_id) ?? []) : []}
              held={activeRow ? (reserved[activeRow.tute_id] ?? 0) : 0}
              coverUrl={activeRow ? (coverUrls[activeRow.tute_id] ?? null) : null}
              month={month}
              nextMonth={nextMonth}
              canEdit={canEdit}
              pending={pending}
              uploadingCover={Boolean(activeRow && uploadingCoverId === activeRow.tute_id)}
              onInlineCount={onInlineCount}
              onUploadCover={onUploadCover}
              onRemoveCover={onRemoveCover}
              onOpenDialog={onOpenDialog}
              onOpenReceive={onOpenReceive}
              onOpenHistory={onOpenHistory}
              onDelete={onDelete}
            />
          </aside>
        </div>
      )}

      {/* Mobile / tablet bottom Sheet inspector */}
      <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] gap-0 rounded-t-2xl p-0 lg:hidden">
          <SheetTitle className="sr-only">{activeRow?.name ?? "Tute details"}</SheetTitle>
          <TuteInspector
            row={activeRow}
            moves={moves}
            openJobs={activeRow ? (openJobsByTute.get(activeRow.tute_id) ?? []) : []}
            held={activeRow ? (reserved[activeRow.tute_id] ?? 0) : 0}
            coverUrl={activeRow ? (coverUrls[activeRow.tute_id] ?? null) : null}
            month={month}
            nextMonth={nextMonth}
            canEdit={canEdit}
            pending={pending}
            uploadingCover={Boolean(activeRow && uploadingCoverId === activeRow.tute_id)}
            onInlineCount={onInlineCount}
            onUploadCover={onUploadCover}
            onRemoveCover={onRemoveCover}
            onOpenDialog={(dlg) => {
              setMobileSheetOpen(false);
              onOpenDialog(dlg);
            }}
            onOpenReceive={(id) => {
              setMobileSheetOpen(false);
              onOpenReceive(id);
            }}
            onOpenHistory={(id) => {
              setMobileSheetOpen(false);
              onOpenHistory(id);
            }}
            onDelete={(r) => {
              setMobileSheetOpen(false);
              onDelete(r);
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * Single Printroom Shelf Row — size-aware via parent `@container`, showing the
 * Booklet Spine Emblem, 10-block Physical Stack Gauge + plain verdict, and
 * either an inline shelf count input (for uncounted tutes) or one calm action.
 */
function ShelfRow({
  row,
  coverUrl,
  selected,
  held,
  hasOpenJob,
  canEdit,
  pending,
  onSelect,
  onInlineCount,
  onReceive,
  onGive,
  onCount,
  onNewJob,
  onDamaged,
  onEdit,
  onHistory,
  onDelete,
}: {
  row: TuteStockRow;
  coverUrl: string | null;
  selected: boolean;
  held: number;
  hasOpenJob: boolean;
  canEdit: boolean;
  pending: boolean;
  onSelect: () => void;
  onInlineCount: (counted: number) => void;
  onReceive: () => void;
  onGive: () => void;
  onCount: () => void;
  onNewJob: () => void;
  onDamaged: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
}) {
  const [inlineVal, setInlineVal] = useState("");
  const left = leftThisMonth(row);
  const verdict = shelfVerdict(row);
  const kind = inferTuteKind(row.name, row.code);
  const kindMeta = BOOKLET_KIND_META[kind];

  const parsedInline = inlineVal.trim() === "" ? null : Number(inlineVal);
  const inlineValid =
    parsedInline !== null && Number.isInteger(parsedInline) && parsedInline >= 0 && parsedInline <= 100000;

  const commitInline = () => {
    if (!inlineValid || pending || parsedInline === null) return;
    onInlineCount(parsedInline);
    setInlineVal("");
  };

  const short = row.status === "out" || row.status === "low";
  const mainAction =
    row.status === "not_counted"
      ? "inline_count"
      : short
        ? hasOpenJob
          ? "receive"
          : "order"
        : row.status === "not_scheduled"
          ? "count"
          : "give";

  return (
    <div
      data-selected={selected || undefined}
      onClick={onSelect}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-3 border-b px-4 py-3.5 transition-colors last:border-b-0",
        "@xl:flex-row @xl:items-center @xl:justify-between",
        selected ? "bg-primary/[0.07]" : "hover:bg-muted/45",
      )}
    >
      {/* Left: Booklet Emblem + Title + Quiet Specs */}
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <BookletEmblem name={row.name} code={row.code} coverUrl={coverUrl} paperReady={row.paper_ready} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
            {row.code && <span className="font-mono @xl:hidden">{row.code} ·</span>}
            <span>{kindMeta.label}</span>
            {row.pages && <span className="tabular-nums">· {row.pages}p</span>}
            {held > 0 && <span className="tabular-nums">· {held} held for post</span>}
            {row.in_print > 0 && (
              <span className="text-primary font-medium tabular-nums">· +{row.in_print} at press</span>
            )}
            {row.need_next > 0 && <span className="tabular-nums">· Next: {row.need_next}</span>}
          </div>
        </div>
        {/* Code column (wide screens; on phones the code leads the line above). */}
        <span className="text-muted-foreground hidden w-24 shrink-0 truncate font-mono text-xs @xl:block" title="Code">
          {row.code || "—"}
        </span>
      </div>

      {/* Right: Physical Stack Supply Gauge + Action */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 @xl:shrink-0 @xl:justify-end"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-[138px] flex-col items-start gap-1.5 @xl:w-[180px] @xl:items-end">
          <div className="flex items-baseline gap-2 text-xs">
            <span className={cn("font-semibold tabular-nums", VERDICT_TEXT_CLASS[verdict.tone])}>
              {verdict.label}
            </span>
            {row.need_this > 0 && (
              <span className="text-muted-foreground tabular-nums">
                {row.status === "not_counted" ? `? / ${left}` : `${row.on_hand} / ${left}`}
              </span>
            )}
          </div>
          <SupplyGauge row={row} />
        </div>

        {canEdit && (
          <div className="flex items-center justify-end gap-1 @xl:w-[162px]">
            {mainAction === "inline_count" && (
              <InputGroup className="h-8 w-[124px] bg-background">
                <InputGroupInput
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100000}
                  step={1}
                  value={inlineVal}
                  onChange={(e) => setInlineVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitInline();
                    }
                  }}
                  placeholder="Count…"
                  aria-label={`Shelf count for ${row.name}`}
                  className="h-8 px-2 text-right text-xs tabular-nums"
                />
                <InputGroupAddon align="inline-end" className="pr-1">
                  <InputGroupButton
                    size="xs"
                    variant="secondary"
                    disabled={!inlineValid || pending}
                    onClick={commitInline}
                    className="h-6 px-2 text-[11px]"
                  >
                    {pending ? <Loader2Icon className="size-3 animate-spin" /> : "Set"}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            )}

            {mainAction === "order" && (
              <Button
                size="sm"
                variant="outline"
                onClick={onNewJob}
                className={cn(
                  "h-8 px-2.5 text-xs",
                  row.status === "out"
                    ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-warning",
                )}
              >
                <PrinterIcon className="size-3.5" />
                Order{row.print_now > 0 ? ` ${row.print_now}` : ""}
              </Button>
            )}

            {mainAction === "receive" && (
              <Button size="sm" className="h-8 px-2.5 text-xs" onClick={onReceive}>
                <PackageCheckIcon className="size-3.5" /> Receive
              </Button>
            )}

            {mainAction === "give" && (
              <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={onGive}>
                <HandIcon className="size-3.5" /> Give out
              </Button>
            )}

            {mainAction === "count" && (
              <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={onCount}>
                <ClipboardCheckIcon className="size-3.5" /> Count
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="size-8 shrink-0"
                  aria-label={`More for ${row.name}`}
                >
                  <EllipsisVerticalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onSelect}>Inspect booklet</DropdownMenuItem>
                {mainAction !== "give" && <DropdownMenuItem onSelect={onGive}>Give out to class</DropdownMenuItem>}
                {mainAction !== "count" && <DropdownMenuItem onSelect={onCount}>Count with note</DropdownMenuItem>}
                {hasOpenJob && mainAction !== "receive" && (
                  <DropdownMenuItem onSelect={onReceive}>Received printed copies</DropdownMenuItem>
                )}
                {mainAction !== "order" && <DropdownMenuItem onSelect={onNewJob}>New print job</DropdownMenuItem>}
                <DropdownMenuItem onSelect={onDamaged}>Mark damaged</DropdownMenuItem>
                <DropdownMenuItem onSelect={onHistory}>View history</DropdownMenuItem>
                <DropdownMenuItem onSelect={onEdit}>Edit tute</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  Delete tute
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}
