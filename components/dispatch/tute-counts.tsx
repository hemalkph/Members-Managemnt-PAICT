"use client";

import { motion, useReducedMotion } from "motion/react";
import { CheckCircle2Icon, SparklesIcon } from "lucide-react";

import type { TuteCount } from "@/lib/dispatch/packing";
import { cn } from "@/lib/utils";
import { useT } from "./lang";

/**
 * What this round needs: copies of each tute (total, packed, left) and the
 * parcels still to pack. Used at the packing station and on the packing page.
 */
export function TuteCounts({
  tutes,
  parcels,
  packed,
  className,
}: {
  tutes: TuteCount[];
  parcels: number;
  packed: number;
  className?: string;
}) {
  const t = useT();
  const reduce = useReducedMotion();
  const copies = tutes.reduce((s, x) => s + x.copies, 0);
  const copiesLeft = tutes.reduce((s, x) => s + x.copies - x.packedCopies, 0);
  const parcelsLeft = Math.max(parcels - packed, 0);

  return (
    <div className={cn("bg-card space-y-3 rounded-xl border p-4 shadow-sm", className)}>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-primary/5 rounded-lg p-2.5">
          <p className="text-muted-foreground text-xs">{t("Parcels to pack")}</p>
          <p className="text-2xl font-semibold tabular-nums">
            {parcelsLeft}
            <span className="text-muted-foreground text-sm font-normal">/{parcels}</span>
          </p>
        </div>
        <div className="bg-primary/5 rounded-lg p-2.5">
          <p className="text-muted-foreground text-xs">{t("Tute copies left")}</p>
          <p className="text-2xl font-semibold tabular-nums">
            {copiesLeft}
            <span className="text-muted-foreground text-sm font-normal">/{copies}</span>
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">{t("Copies needed per tute")}</p>
        {tutes.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t("Nothing yet.")}</p>
        ) : (
          <ul className="space-y-2.5">
            {tutes.map((x) => {
              const left = x.copies - x.packedCopies;
              const pct = x.copies > 0 ? (x.packedCopies / x.copies) * 100 : 0;
              return (
                <li key={x.id} title={x.title}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="font-mono font-semibold">{x.code}</span>
                      {x.extra && <SparklesIcon className="size-3 shrink-0 text-amber-600" aria-label={t("Extra")} />}
                      <span className="text-muted-foreground truncate text-xs">{x.title}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {left === 0 && x.copies > 0 ? (
                        <CheckCircle2Icon className="text-success inline size-4" aria-label={t("Done")} />
                      ) : (
                        <span className="font-semibold">{t("{n} left", { n: left })}</span>
                      )}
                      <span className="text-muted-foreground text-xs"> · {x.copies}</span>
                    </span>
                  </div>
                  <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                    <motion.div
                      className={cn("h-full rounded-full", left === 0 ? "bg-success" : "bg-primary")}
                      initial={false}
                      animate={{ width: `${pct}%` }}
                      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 20 }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
