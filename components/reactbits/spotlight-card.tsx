"use client";

// React Bits — SpotlightCard (https://reactbits.dev/components/spotlight-card)
// Adapted to TypeScript + Tailwind + shadcn card styles. A soft light follows
// the pointer on hover; the card lifts slightly (no lift with reduced motion).

import { useRef, type ComponentProps, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

type SpotlightCardProps = ComponentProps<"div"> & {
  spotlightColor?: string;
};

export default function SpotlightCard({
  children,
  className,
  spotlightColor = "color-mix(in oklch, var(--primary) 16%, transparent)",
  onMouseMove,
  ...props
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mouse-x", `${event.clientX - rect.left}px`);
      el.style.setProperty("--mouse-y", `${event.clientY - rect.top}px`);
    }
    onMouseMove?.(event);
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      className={cn(
        "group/spotlight bg-card text-card-foreground relative isolate overflow-hidden rounded-xl border shadow-sm",
        "transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md motion-reduce:hover:translate-y-0",
        className,
      )}
      {...props}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-hover/spotlight:opacity-100"
        style={{
          background: `radial-gradient(320px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), ${spotlightColor}, transparent 75%)`,
        }}
      />
      {children}
    </div>
  );
}
