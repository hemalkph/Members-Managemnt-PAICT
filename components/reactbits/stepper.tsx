"use client";

// React Bits — Stepper (https://reactbits.dev/components/stepper)
// Adapted to TypeScript + Tailwind as a read-only progress stepper: animated
// step circles (done ✓, active pulse, waiting, skipped) joined by connectors
// that fill in as steps complete. Reduced motion turns the animations off.

import { motion, useReducedMotion } from "motion/react";
import { CheckIcon, MinusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepState = "done" | "active" | "waiting" | "skipped" | "overdue";

export type Step = { key: string; label: string; state: StepState; hint?: string };

const CIRCLE: Record<StepState, string> = {
  done: "bg-success border-success text-white",
  active: "bg-primary border-primary text-primary-foreground",
  overdue: "bg-destructive border-destructive text-white",
  waiting: "bg-background border-border text-muted-foreground",
  skipped: "bg-muted border-dashed border-border text-muted-foreground",
};

function StepCircle({ state, index, size }: { state: StepState; index: number; size: "sm" | "md" }) {
  const reduce = useReducedMotion();
  // Same markup on server and client (no hydration mismatch); with reduced
  // motion the pulse simply fades out instead of repeating.
  const pulsing = state === "active" || state === "overdue";
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center", size === "sm" ? "size-6" : "size-8")}>
      {pulsing && (
        <motion.span
          className={cn("absolute inset-0 rounded-full", state === "overdue" ? "bg-destructive/40" : "bg-primary/40")}
          initial={{ scale: 1, opacity: 0.6 }}
          animate={reduce ? { scale: 1, opacity: 0 } : { scale: 1.6, opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <motion.span
        className={cn(
          "relative flex size-full items-center justify-center rounded-full border-2 font-semibold",
          size === "sm" ? "text-[10px]" : "text-xs",
          CIRCLE[state],
        )}
        initial={false}
        animate={{ scale: state === "active" || state === "overdue" ? 1.05 : 1 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 20 }}
      >
        {state === "done" ? (
          <CheckIcon className={size === "sm" ? "size-3.5" : "size-4"} strokeWidth={3} />
        ) : state === "skipped" ? (
          <MinusIcon className={size === "sm" ? "size-3.5" : "size-4"} />
        ) : (
          index + 1
        )}
      </motion.span>
    </span>
  );
}

function Connector({ filled }: { filled: boolean }) {
  const reduce = useReducedMotion();
  return (
    <span className="bg-border relative h-0.5 min-w-3 flex-1 overflow-hidden rounded-full">
      <motion.span
        className="bg-success absolute inset-y-0 left-0"
        initial={false}
        animate={{ width: filled ? "100%" : "0%" }}
        transition={reduce ? { duration: 0 } : { duration: 0.4, ease: "easeOut" }}
      />
    </span>
  );
}

/** Horizontal stepper. `compact` hides labels (for lists). */
export default function Stepper({ steps, compact = false }: { steps: Step[]; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-1" aria-label={steps.map((s) => `${s.label}: ${s.state}`).join(", ")}>
        {steps.map((s, i) => (
          <div key={s.key} className="flex flex-1 items-center gap-1 last:flex-none" title={`${s.label}${s.hint ? ` – ${s.hint}` : ""}`}>
            <StepCircle state={s.state} index={i} size="sm" />
            {i < steps.length - 1 && <Connector filled={s.state === "done" || s.state === "skipped"} />}
          </div>
        ))}
      </div>
    );
  }
  return (
    <ol className="flex items-start" aria-label="Stages">
      {steps.map((s, i) => (
        <li key={s.key} className="flex flex-1 flex-col items-center gap-2 text-center">
          <div className="flex w-full items-center gap-1">
            <span className={cn("flex-1", i === 0 && "invisible")}>
              <Connector filled={i > 0 && (steps[i - 1].state === "done" || steps[i - 1].state === "skipped")} />
            </span>
            <StepCircle state={s.state} index={i} size="md" />
            <span className={cn("flex-1", i === steps.length - 1 && "invisible")}>
              <Connector filled={s.state === "done" || s.state === "skipped"} />
            </span>
          </div>
          <div className="px-1">
            <p className={cn("text-xs font-medium sm:text-sm", s.state === "skipped" && "text-muted-foreground line-through")}>
              {s.label}
            </p>
            {s.hint && <p className="text-muted-foreground text-[11px] leading-tight sm:text-xs">{s.hint}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
