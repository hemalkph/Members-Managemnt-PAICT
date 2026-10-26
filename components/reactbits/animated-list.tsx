"use client";

// React Bits — AnimatedList (https://reactbits.dev/components/animated-list)
// Adapted to TypeScript + Tailwind: each item scales and fades in as it
// scrolls into view. Items are any React nodes (not just strings), there is no
// fixed height and no inner scroll, so it works inside normal page scrolling.
// With prefers-reduced-motion the items simply appear.

import { useRef, type ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

function AnimatedItem({ children, index }: { children: ReactNode; index: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { amount: 0.3, once: true });
  const reduce = useReducedMotion();

  return (
    <motion.li
      ref={ref}
      // Same first render on the server and the client (no hydration mismatch);
      // with reduced motion the change is instant.
      initial={{ scale: 0.96, opacity: 0, y: 8 }}
      animate={reduce || inView ? { scale: 1, opacity: 1, y: 0 } : undefined}
      transition={reduce ? { duration: 0 } : { duration: 0.22, delay: Math.min(index, 8) * 0.03 }}
      className="min-w-0 list-none"
    >
      {children}
    </motion.li>
  );
}

export default function AnimatedList({
  items,
  className,
  "aria-label": ariaLabel,
}: {
  items: { key: string | number; node: ReactNode }[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <ul className={cn("grid gap-2", className)} aria-label={ariaLabel}>
      {items.map((item, i) => (
        <AnimatedItem key={item.key} index={i}>
          {item.node}
        </AnimatedItem>
      ))}
    </ul>
  );
}
