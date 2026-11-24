"use client";

import GlareHover from "@/components/reactbits/glare-hover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TuteStockRow } from "@/lib/supabase/database.types";
import {
  bookletBadgeLines,
  inferTuteKind,
  leftThisMonth,
  type ShelfVerdictTone,
  type TuteBookletKind,
} from "@/lib/tutes/helpers";
import { cn } from "@/lib/utils";

export const BOOKLET_KIND_META: Record<
  TuteBookletKind,
  { label: string; surface: string; ink: string }
> = {
  paper: {
    label: "Paper pack",
    surface:
      "bg-[color-mix(in_oklch,var(--chart-1)_15%,var(--background))] border-[color-mix(in_oklch,var(--chart-1)_28%,var(--border))]",
    ink: "text-[var(--chart-1)]",
  },
  note: {
    label: "Short note",
    surface:
      "bg-[color-mix(in_oklch,var(--chart-2)_15%,var(--background))] border-[color-mix(in_oklch,var(--chart-2)_28%,var(--border))]",
    ink: "text-[var(--chart-2)]",
  },
  book: {
    label: "Question book",
    surface:
      "bg-[color-mix(in_oklch,var(--chart-3)_16%,var(--background))] border-[color-mix(in_oklch,var(--chart-3)_30%,var(--border))]",
    ink: "text-[var(--chart-3)]",
  },
  tute: {
    label: "Tute",
    surface: "bg-muted/70 border-border",
    ink: "text-foreground/80",
  },
};

export const VERDICT_TEXT_CLASS: Record<ShelfVerdictTone, string> = {
  destructive: "text-destructive",
  warning: "text-amber-600 dark:text-warning",
  success: "text-success",
  info: "text-primary",
  muted: "text-muted-foreground",
};

/**
 * Tactile portrait booklet cover thumbnail.
 * Displays the uploaded cover photo when set, or a crisp 2-line folded-spine
 * emblem (never truncating codes like 2023NWP or L01-SN) as fallback.
 */
export function BookletEmblem({
  name,
  code,
  coverUrl,
  paperReady,
  size = "sm",
  glare = false,
  className,
}: {
  name: string;
  code: string;
  coverUrl?: string | null;
  paperReady?: boolean;
  size?: "sm" | "lg";
  glare?: boolean;
  className?: string;
}) {
  const kind = inferTuteKind(name, code);
  const meta = BOOKLET_KIND_META[kind];
  const [line1, line2] = bookletBadgeLines(code, name);

  const dims = size === "lg" ? "h-20 w-16" : "h-14 w-11";

  const emblem = coverUrl ? (
    <div
      className={cn(
        "bg-muted relative shrink-0 overflow-hidden rounded-md select-none",
        dims,
        className,
      )}
      title={`${name} · ${meta.label}${paperReady ? " · PDF ready in Paper Library" : ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Private signed Supabase URL */}
      <img
        src={coverUrl}
        alt={`${name} cover`}
        loading="lazy"
        decoding="async"
        className="size-full object-cover"
      />
      {/* Subtle folded book-spine highlight + crisp 1px inset hairline */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-black/10 dark:ring-white/10 shadow-[inset_3px_0_0_rgba(255,255,255,0.22),inset_4px_0_0_rgba(0,0,0,0.25)]"
      />
      {paperReady && (
        <span
          className="bg-success ring-background absolute right-1 bottom-1 size-2 rounded-full ring-2"
          aria-label="PDF ready in Paper Library"
        />
      )}
    </div>
  ) : (
    <div
      className={cn(
        "relative flex shrink-0 flex-col items-center justify-center rounded-md border px-1 font-mono font-semibold leading-none select-none",
        // Subtle folded-spine crease on the left edge of the physical booklet
        "shadow-[inset_3px_0_0_rgba(255,255,255,0.14),inset_4px_0_0_rgba(0,0,0,0.2)]",
        meta.surface,
        meta.ink,
        dims,
        className,
      )}
      title={`${meta.label}${paperReady ? " · PDF ready in Paper Library" : ""}`}
    >
      <span className={cn("tracking-tight", line2 ? (size === "lg" ? "text-[11px] opacity-80" : "text-[9.5px] opacity-80") : size === "lg" ? "text-xs" : "text-[11px]")}>
        {line1}
      </span>
      {line2 && (
        <span className={cn("mt-0.5 font-bold tracking-tight", size === "lg" ? "text-xs" : "text-[10.5px]")}>
          {line2}
        </span>
      )}
      {paperReady && (
        <span
          className="bg-success absolute right-1 bottom-1 size-1.5 rounded-full"
          aria-label="PDF ready in Paper Library"
        />
      )}
    </div>
  );

  if (glare) {
    return <GlareHover className="shrink-0 rounded-md">{emblem}</GlareHover>;
  }
  return emblem;
}

/**
 * 10-block physical stack supply gauge: each block represents 10% of the copies
 * still needed this month. Solid = on shelf, tinted = at press, hollow = gap,
 * dashed = shelf not counted yet.
 */
export function SupplyGauge({
  row,
  className,
}: {
  row: Pick<TuteStockRow, "status" | "on_hand" | "in_print" | "need_this" | "given_this">;
  className?: string;
}) {
  const blocks = 10;
  const left = leftThisMonth(row);

  let tooltipText = "";
  let cells: { kind: "solid" | "print" | "empty" | "dashed"; tone?: "destructive" | "warning" | "success" }[] = [];

  if (row.status === "not_counted") {
    tooltipText = "Shelf not counted yet";
    cells = Array.from({ length: blocks }, () => ({ kind: "dashed" }));
  } else if (row.status === "not_scheduled") {
    const filled = row.on_hand > 0 ? Math.min(blocks, Math.max(2, Math.ceil(row.on_hand / 25))) : 0;
    tooltipText = `${row.on_hand} on shelf · not scheduled this month`;
    cells = Array.from({ length: blocks }, (_, i) =>
      i < filled ? { kind: "solid", tone: "success" } : { kind: "empty" },
    );
  } else if (left === 0 && row.need_this > 0) {
    tooltipText = `All ${row.need_this} copies handed out · ${row.on_hand} spare on shelf`;
    cells = Array.from({ length: blocks }, () => ({ kind: "solid", tone: "success" }));
  } else {
    const denom = Math.max(left, 1);
    const shelfBlocks = Math.min(blocks, Math.round((row.on_hand / denom) * blocks));
    const printBlocks = Math.min(blocks - shelfBlocks, Math.round((row.in_print / denom) * blocks));
    const tone = row.status === "out" ? "destructive" : row.status === "low" ? "warning" : "success";
    tooltipText = `${row.on_hand} on shelf${row.in_print > 0 ? ` + ${row.in_print} at press` : ""} · ${left} still needed`;
    cells = Array.from({ length: blocks }, (_, idx) => {
      if (idx < shelfBlocks) return { kind: "solid", tone };
      if (idx < shelfBlocks + printBlocks) return { kind: "print" };
      return { kind: "empty", tone: row.status === "out" ? "destructive" : undefined };
    });
  }

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn("inline-flex items-center gap-1", className)}
            role="img"
            aria-label={tooltipText}
          >
            {cells.map((c, idx) => (
              <span
                key={idx}
                className={cn(
                  "h-3.5 w-2 rounded-[2px] transition-colors",
                  c.kind === "dashed" && "border border-dashed border-muted-foreground/35 bg-transparent",
                  c.kind === "solid" && c.tone === "success" && "bg-success",
                  c.kind === "solid" && c.tone === "warning" && "bg-amber-500 dark:bg-warning",
                  c.kind === "solid" && c.tone === "destructive" && "bg-destructive",
                  c.kind === "print" && "border border-primary/70 bg-primary/35",
                  c.kind === "empty" &&
                    (c.tone === "destructive"
                      ? "border border-destructive/40 bg-destructive/5"
                      : "border border-border bg-background"),
                )}
              />
            ))}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs tabular-nums">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
