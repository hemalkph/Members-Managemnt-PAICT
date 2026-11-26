"use client";

// React Bits — CountUp (https://reactbits.dev/text-animations/count-up)
// Adapted to TypeScript. Animates a number with an ease-out when it scrolls into view.
// With prefers-reduced-motion the final number is shown immediately.

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";
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

  // A timed ease-out, not a spring: a heavily damped spring crawls for seconds and
  // left money totals showing wrong cents (e.g. 24,999.41 for 25,000.00).
  useEffect(() => {
    if (!inView) return;
    const show = (value: number) => {
      if (ref.current) ref.current.textContent = format(value);
    };
    if (reduceMotion) {
      show(to);
      return;
    }
    const controls = animate(from, to, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: show,
      onComplete: () => show(to),
    });
    return () => controls.stop();
  }, [inView, from, to, delay, duration, reduceMotion, format]);

  return <span ref={ref} className={cn("tabular-nums", className)} aria-label={format(to)} />;
}
