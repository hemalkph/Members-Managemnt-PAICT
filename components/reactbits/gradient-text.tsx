// React Bits — GradientText (https://reactbits.dev/text-animations/gradient-text)
// Adapted to TypeScript + Tailwind theme colours. The gradient slowly moves
// across the text; it stands still with prefers-reduced-motion (globals.css).

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export default function GradientText({
  children,
  className,
  colors = ["var(--primary)", "var(--chart-2)", "var(--chart-4)", "var(--primary)"],
}: {
  children: ReactNode;
  className?: string;
  colors?: string[];
}) {
  return (
    <span
      className={cn("animate-gradient inline-block bg-clip-text text-transparent", className)}
      style={{ backgroundImage: `linear-gradient(to right, ${colors.join(", ")})`, backgroundSize: "300% 100%" }}
    >
      {children}
    </span>
  );
}
