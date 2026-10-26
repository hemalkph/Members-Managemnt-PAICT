"use client";

// React Bits — BlurText (https://reactbits.dev/text-animations/blur-text)
// Adapted to TypeScript + Tailwind. Words fade in from a blur, one after another.
// With prefers-reduced-motion the text appears at once (zero-length animation).
// The markup is identical on server and client, so hydration always matches.

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

type BlurTextProps = {
  text: string;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  /** Delay between words in ms. */
  delay?: number;
  animateBy?: "words" | "letters";
  direction?: "top" | "bottom";
  stepDuration?: number;
};

export default function BlurText({
  text,
  as: Tag = "p",
  className,
  delay = 90,
  animateBy = "words",
  direction = "top",
  stepDuration = 0.3,
}: BlurTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.1 });
  const reduceMotion = useReducedMotion();

  const segments = animateBy === "words" ? text.split(" ") : Array.from(text);
  const offset = direction === "top" ? -24 : 24;
  const from = { filter: "blur(10px)", opacity: 0, y: offset };
  const to = {
    filter: ["blur(10px)", "blur(4px)", "blur(0px)"],
    opacity: [0, 0.6, 1],
    y: [offset, -offset / 6, 0],
  };

  return (
    <Tag className={className}>
      <span className="sr-only">{text}</span>
      <span ref={ref} aria-hidden className={cn("inline-flex flex-wrap")}>
        {segments.map((segment, index) => (
          <motion.span
            key={`${segment}-${index}`}
            className="inline-block will-change-[transform,filter,opacity]"
            initial={from}
            animate={inView ? to : from}
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    duration: stepDuration * 2,
                    times: [0, 0.5, 1],
                    delay: (index * delay) / 1000,
                    ease: "easeOut",
                  }
            }
          >
            {segment === " " ? " " : segment}
            {animateBy === "words" && index < segments.length - 1 && " "}
          </motion.span>
        ))}
      </span>
    </Tag>
  );
}
