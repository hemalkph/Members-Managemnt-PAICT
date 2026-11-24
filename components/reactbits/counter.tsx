"use client";

// React Bits — Counter (https://reactbits.dev/components/counter)
// Adapted to TypeScript + Tailwind + motion/react for mechanical rolling digits
// like a printing-press sheet counter. Falls back to static tabular text under
// prefers-reduced-motion.

import { useEffect } from "react";
import { motion, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { cn } from "@/lib/utils";

function DigitWheel({
  mv,
  number,
  height,
}: {
  mv: MotionValue<number>;
  number: number;
  height: number;
}) {
  const y = useTransform(mv, (latest) => {
    const placeValue = latest % 10;
    const offset = (10 + number - placeValue) % 10;
    let memo = offset * height;
    if (offset > 5) memo -= 10 * height;
    return memo;
  });

  return (
    <motion.span
      style={{ y }}
      className="absolute inset-0 flex items-center justify-center leading-none"
    >
      {number}
    </motion.span>
  );
}

function DigitColumn({
  place,
  value,
  height,
}: {
  place: number;
  value: number;
  height: number;
}) {
  const rounded = Math.floor(value / place);
  const animatedValue = useSpring(rounded, { stiffness: 260, damping: 28, mass: 0.7 });

  useEffect(() => {
    animatedValue.set(rounded);
  }, [animatedValue, rounded]);

  return (
    <span
      style={{ height }}
      className="relative inline-block w-[1ch] overflow-hidden tabular-nums"
      aria-hidden="true"
    >
      {Array.from({ length: 10 }, (_, i) => (
        <DigitWheel key={i} mv={animatedValue} number={i} height={height} />
      ))}
    </span>
  );
}

export default function Counter({
  value,
  height = 24,
  className,
}: {
  value: number;
  /** Line box height in px for each rolling digit column. */
  height?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const safe = Math.max(0, Math.round(value));

  if (reduceMotion) {
    return (
      <span className={cn("inline-flex items-center tabular-nums", className)}>
        {safe.toLocaleString("en-GB")}
      </span>
    );
  }

  const digits = Math.max(1, String(safe).length);
  const places = Array.from({ length: digits }, (_, idx) => 10 ** (digits - 1 - idx));

  return (
    <span
      className={cn("inline-flex items-center overflow-hidden tabular-nums leading-none", className)}
      aria-label={String(safe)}
    >
      {places.map((place) => (
        <DigitColumn key={place} place={place} value={safe} height={height} />
      ))}
    </span>
  );
}
