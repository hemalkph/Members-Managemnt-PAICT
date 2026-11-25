"use client";

import { useEffect, useState } from "react";
import { TimerIcon } from "lucide-react";
import { countdownText, stageDeadline } from "@/lib/papers/times";
import { cn } from "@/lib/utils";

/** "2 d 4 h left" / "Late 1 d 3 h" for an open stage; updates every minute. Nothing for done or skipped stages. */
export function StageCountdown({
  dueAt,
  dueDate,
  status,
  className,
}: {
  dueAt: string | null;
  dueDate: string | null;
  status: string;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);
  // Start on the client only (no server/client time mismatch), then tick every minute.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const deadline = stageDeadline(dueAt, dueDate);
  if (deadline === null || status === "done" || status === "skipped" || now === null) return null;
  const { text, late } = countdownText(deadline, now);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums",
        late ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      <TimerIcon className="size-3" />
      {text}
    </span>
  );
}
