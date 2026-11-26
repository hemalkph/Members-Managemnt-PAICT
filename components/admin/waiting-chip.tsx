import { HourglassIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isOverLimit, waitingHours, waitingText } from "@/lib/review/waiting";

/** "Waiting 30 h" on pending work; red once it's over the review limit. */
export function WaitingChip({ since, limitHours, nowMs }: { since: string; limitHours: number; nowMs: number }) {
  const hours = waitingHours(since, nowMs);
  const over = isOverLimit(hours, limitHours);
  return (
    <Badge variant={over ? "destructive" : "outline"} title={`Reviews should be done within ${limitHours} h`}>
      <HourglassIcon /> Waiting {waitingText(hours)}
    </Badge>
  );
}
