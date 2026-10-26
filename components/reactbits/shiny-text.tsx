// React Bits — ShinyText (https://reactbits.dev/text-animations/shiny-text)
// Adapted to Tailwind. A light sweep moves across the text.
// The global prefers-reduced-motion rule in globals.css stops the sweep.

import { cn } from "@/lib/utils";

export default function ShinyText({
  text,
  className,
  disabled = false,
}: {
  text: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-block bg-clip-text text-transparent [background-size:200%_100%]",
        !disabled && "animate-shine",
        className,
      )}
      style={{
        backgroundImage:
          "linear-gradient(120deg, var(--foreground) 40%, color-mix(in oklch, var(--primary) 70%, white) 50%, var(--foreground) 60%)",
      }}
    >
      {text}
    </span>
  );
}
