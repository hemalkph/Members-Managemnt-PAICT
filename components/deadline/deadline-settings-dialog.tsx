"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarCogIcon, Loader2Icon } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { updateDeadlineSettingsAction } from "@/lib/actions/deadlines";
import type { DeadlineSettings } from "@/lib/deadlines";

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Main admins: the normal monthly deadline and how early reminders start. */
export function DeadlineSettingsDialog({ settings }: { settings: DeadlineSettings }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [day, setDay] = useState(String(settings.day));
  const [reminderDays, setReminderDays] = useState(String(settings.reminderDays));
  const [pending, startTransition] = useTransition();

  const dayNum = Number(day);
  const remNum = Number(reminderDays);
  const valid = Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 28 && Number.isInteger(remNum) && remNum >= 0 && remNum <= 10;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) {
      toast.error("Choose a day from 1 to 28 and 0–10 reminder days");
      return;
    }
    startTransition(async () => {
      const result = await updateDeadlineSettingsAction({ enabled, day: dayNum, reminderDays: remNum });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setEnabled(settings.enabled);
          setDay(String(settings.day));
          setReminderDays(String(settings.reminderDays));
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <CalendarCogIcon /> Deadline
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Monthly work deadline</DialogTitle>
          <DialogDescription>
            Members must log a month&apos;s work by a day of the next month. After that only admins can add or change
            it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="deadline-on">Use a deadline</Label>
              <p className="text-muted-foreground text-xs">Off = members can log any open month.</p>
            </div>
            <Switch id="deadline-on" checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="deadline-day">Last day (of next month)</Label>
              <Input
                id="deadline-day"
                type="number"
                inputMode="numeric"
                min={1}
                max={28}
                value={day}
                disabled={!enabled}
                onChange={(e) => setDay(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reminder-days">Remind (days before)</Label>
              <Input
                id="reminder-days"
                type="number"
                inputMode="numeric"
                min={0}
                max={10}
                value={reminderDays}
                disabled={!enabled}
                onChange={(e) => setReminderDays(e.target.value)}
              />
            </div>
          </div>
          {enabled && valid && (
            <p className="bg-muted/50 rounded-lg p-3 text-sm">
              Example: October work must be logged by <strong>{ordinal(dayNum)} November</strong>. Reminders start{" "}
              {remNum === 0 ? "on the last day" : `${remNum} day${remNum === 1 ? "" : "s"} before`}.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {pending && <Loader2Icon className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
