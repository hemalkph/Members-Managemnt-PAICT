"use client";

// React Bits — GlareHover (https://reactbits.dev/animations/glare-hover)
// Adapted to TypeScript + Tailwind with opt-in motion-safe transform sweep so
// reduced-motion users keep a clean static surface.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export default function GlareHover({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("group/glare relative inline-flex overflow-hidden", className)}>
      {children}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 -translate-x-full skew-x-[-20deg]",
          "bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0",
          "motion-safe:transition-[transform,opacity] motion-safe:duration-500 motion-safe:ease-out",
          "motion-safe:group-hover/glare:translate-x-[140%] motion-safe:group-hover/glare:opacity-100",
        )}
      />
    </div>
  );
}
