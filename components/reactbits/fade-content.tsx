"use client";

// React Bits — FadeContent (https://reactbits.dev/animations/fade-content)
// Adapted to TypeScript + motion/react for fast Operate-mode panel switches.
// Uses compositor-only transform/opacity and renders immediately when reduced
// motion is preferred.

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export default function FadeContent({
  children,
  duration = 0.18,
  y = 4,
  className,
}: {
  children: ReactNode;
  duration?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, ease: [0.23, 1, 0.32, 1] }}
      className={cn("min-w-0", className)}
    >
      {children}
    </motion.div>
  );
}
