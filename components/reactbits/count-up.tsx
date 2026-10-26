"use client";

// React Bits — CountUp (https://reactbits.dev/text-animations/count-up)
// Adapted to TypeScript. Animates a number with a spring when it scrolls into view.
// With prefers-reduced-motion the final number is shown immediately.

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { cn } from "@/lib/utils";

type CountUpProps = {
  to: number;
  from?: number;
  /** Seconds. */
  duration?: number;
  /** Seconds before it starts. */
  delay?: number;
  /** Digits after the decimal point (e.g. 2 for rupees and cents). */
  decimals?: number;
  className?: string;
};

export default function CountUp({ to, from = 0, duration = 1.2, delay = 0, decimals = 0, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(from);
  const spring = useSpring(motionValue, {
    damping: 20 + 40 * (1 / duration),
    stiffness: 100 * (1 / duration),
  });
  const inView = useInView(ref, { once: true });

  const format = useCallback(
    (value: number) =>
      new Intl.NumberFormat("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
        decimals > 0 ? value : Math.round(value),
      ),
    [decimals],
  );

  // Set the starting text before paint.
  useLayoutEffect(() => {
    if (ref.current && !ref.current.textContent) {
      ref.current.textContent = format(reduceMotion ? to : from);
    }
  }, [format, from, to, reduceMotion]);

  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) {
      motionValue.jump(to);
      spring.jump(to);
      if (ref.current) ref.current.textContent = format(to);
      return;
    }
    const timer = setTimeout(() => motionValue.set(to), delay * 1000);
    return () => clearTimeout(timer);
  }, [inView, to, delay, motionValue, spring, reduceMotion, format]);

  useEffect(
    () =>
      spring.on("change", (latest) => {
        if (ref.current) ref.current.textContent = format(latest);
      }),
    [spring, format],
  );

  return <span ref={ref} className={cn("tabular-nums", className)} aria-label={format(to)} />;
}
