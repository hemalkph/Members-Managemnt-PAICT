import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A simple CSS phone frame (iPhone-style) for previews. */
export function PhoneMockup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative mx-auto w-[300px] max-w-full", className)}>
      {/* side buttons */}
      <span aria-hidden className="absolute top-28 -left-[3px] h-8 w-[3px] rounded-l bg-neutral-700" />
      <span aria-hidden className="absolute top-40 -left-[3px] h-14 w-[3px] rounded-l bg-neutral-700" />
      <span aria-hidden className="absolute top-36 -right-[3px] h-20 w-[3px] rounded-r bg-neutral-700" />
      <div className="rounded-[3rem] bg-neutral-900 p-[10px] shadow-2xl ring-1 ring-neutral-700/60 dark:ring-neutral-600">
        <div className="bg-background relative flex aspect-[9/19.5] flex-col overflow-hidden rounded-[2.4rem]">
          {/* status bar + dynamic island */}
          <div className="relative flex h-11 shrink-0 items-center justify-between px-7 text-[11px] font-semibold">
            <span>9:41</span>
            <span aria-hidden className="absolute top-2.5 left-1/2 h-6 w-24 -translate-x-1/2 rounded-full bg-neutral-900" />
            <span className="flex items-center gap-1" aria-hidden>
              <span className="flex items-end gap-[2px]">
                <span className="h-1.5 w-[3px] rounded-sm bg-current" />
                <span className="h-2 w-[3px] rounded-sm bg-current" />
                <span className="h-2.5 w-[3px] rounded-sm bg-current" />
                <span className="h-3 w-[3px] rounded-sm bg-current" />
              </span>
              <span className="ml-1 h-3 w-6 rounded-[4px] border border-current p-[1.5px]">
                <span className="block h-full w-4/5 rounded-[2px] bg-current" />
              </span>
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {/* home indicator */}
          <div className="flex h-6 shrink-0 items-center justify-center">
            <span aria-hidden className="bg-foreground/80 h-1 w-28 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
