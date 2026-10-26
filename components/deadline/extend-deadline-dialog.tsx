"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarPlusIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setMonthDeadlineAction } from "@/lib/actions/deadlines";

/** Main admins: give one month more (or less) time. */
export function ExtendDeadlineDialog({
  month,
  monthLabel,
  lastDay,
  extended,
  minDate,
}: {
  month: string;
  monthLabel: string;
  /** Current last day "YYYY-MM-DD" (or null when there is no deadline). */
  lastDay: string | null;
  extended: boolean;
  /** First day of the month, "YYYY-MM-DD". */
  minDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(lastDay ?? "");
  const [pending, startTransition] = useTransition();

  const save = (lastDayValue: string) =>
    startTransition(async () => {
      const result = await setMonthDeadlineAction({ month, lastDay: lastDayValue });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setValue(lastDay ?? "");
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarPlusIcon /> {lastDay ? "Change deadline" : "Set deadline"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{monthLabel} deadline</DialogTitle>
          <DialogDescription>
            The last day members can log or change {monthLabel} work. Only this month changes; the normal rule stays the
            same.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value) save(value);
          }}
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="month-last-day">Last day</Label>
            <Input
              id="month-last-day"
              type="date"
              min={minDate}
              value={value}
              required
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {extended ? (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => save("")}>
                <RotateCcwIcon /> Normal rule
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={pending || !value}>
              {pending && <Loader2Icon className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
