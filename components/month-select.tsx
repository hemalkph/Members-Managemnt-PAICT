"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { monthLabel, periodRangeLabel, recentMonths, shiftMonth } from "@/lib/month";
import { cn } from "@/lib/utils";

/** Month filter stored in the URL (?month=YYYY-MM). */
export function MonthSelect({ value, className }: { value: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const months = recentMonths(24, true);
  if (!months.includes(value)) months.push(value);

  const go = (month: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", month);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  return (
    <div className={cn("flex items-center gap-1", pending && "opacity-70", className)}>
      <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => go(shiftMonth(value, -1))}>
        <ChevronLeftIcon />
      </Button>
      <Select value={value} onValueChange={go}>
        <SelectTrigger className="w-[184px]" aria-label="Month">
          <CalendarIcon />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((m) => (
            <SelectItem key={m} value={m}>
              {monthLabel(m)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="icon" aria-label="Next month" onClick={() => go(shiftMonth(value, 1))}>
        <ChevronRightIcon />
      </Button>
      <span className="text-muted-foreground hidden pl-1 text-xs whitespace-nowrap lg:inline">
        {periodRangeLabel(value)}
      </span>
    </div>
  );
}
