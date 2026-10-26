import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";

/** "Up 12.5% from last month" style footer line. */
export function TrendNote({ change, subject = "this month" }: { change: number | null; subject?: string }) {
  if (change === null) {
    return (
      <span className="flex items-center gap-2 leading-none font-medium">
        New spending {subject} <TrendingUpIcon className="size-4" />
      </span>
    );
  }
  if (Math.abs(change) < 0.05) {
    return (
      <span className="flex items-center gap-2 leading-none font-medium">
        Same as last month <MinusIcon className="size-4" />
      </span>
    );
  }
  const up = change > 0;
  return (
    <span className="flex items-center gap-2 leading-none font-medium">
      {up ? "Up" : "Down"} {Math.abs(change).toFixed(1)}% {subject}
      {up ? <TrendingUpIcon className="size-4" /> : <TrendingDownIcon className="size-4" />}
    </span>
  );
}
