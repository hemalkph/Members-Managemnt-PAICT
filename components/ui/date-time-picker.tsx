"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fromColomboISO, toColomboISO } from "@/lib/papers/times";
import { cn } from "@/lib/utils";

const LABEL = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Colombo",
});
/** Narrow rows: "Fri 4 Dec 11:00". */
const COMPACT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Colombo",
});

/** A day as a local Date at noon (so the calendar shows the right day in any browser time zone). */
const dayToDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};
const dateToDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** shadcn Calendar + a time field, in Sri Lanka time. `value` is an ISO string ("…+05:30"). */
export function DateTimePicker({
  value,
  onChange,
  minDate,
  disabled,
  ariaLabel,
  className,
  compact = false,
}: {
  value: string;
  onChange: (iso: string) => void;
  /** "YYYY-MM-DD": days before it can't be picked. */
  minDate?: string;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  /** Shorter 24-hour label for narrow rows. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { date, time } = value ? fromColomboISO(value) : { date: "", time: "08:00" };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn("w-full justify-start gap-2 font-normal", !value && "text-muted-foreground", className)}
        >
          <CalendarIcon className="size-4 shrink-0" />
          <span className="truncate">{value ? (compact ? COMPACT : LABEL).format(new Date(value)).replace(",", "") : "Pick a date"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date ? dayToDate(date) : undefined}
          defaultMonth={date ? dayToDate(date) : undefined}
          disabled={minDate ? { before: dayToDate(minDate) } : undefined}
          onSelect={(d) => d && onChange(toColomboISO(dateToDay(d), time))}
        />
        <div className="flex items-center gap-2 border-t p-3">
          <label htmlFor={`${ariaLabel}-time`} className="text-muted-foreground text-xs">
            Time
          </label>
          <Input
            id={`${ariaLabel}-time`}
            type="time"
            step={900}
            value={time}
            disabled={!date}
            onChange={(e) => e.target.value && date && onChange(toColomboISO(date, e.target.value))}
            className="h-8"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
