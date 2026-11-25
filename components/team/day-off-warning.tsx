import { CalendarOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/core/format";

/** A deadline on someone's day off: say so and offer the next working day. Never blocks saving. */
export function DayOffWarning({
  name,
  day,
  nextDay,
  onMove,
}: {
  name: string;
  day: string;
  nextDay: string;
  onMove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-warning">
      <CalendarOffIcon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {name} is away on {formatDay(day)}.
      </span>
      <Button type="button" size="sm" variant="outline" className="h-7" onClick={onMove}>
        Move to {formatDay(nextDay)}
      </Button>
    </div>
  );
}
