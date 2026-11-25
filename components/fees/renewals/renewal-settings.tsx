"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon, TargetIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { saveRenewalSettingsAction } from "@/lib/actions/renewals";

/** The renewal target: a share of last month's students by a day of the month. */
export function RenewalSettings({ dueDay, targetPct }: { dueDay: number; targetPct: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(String(dueDay));
  const [pct, setPct] = useState(String(targetPct));
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const res = await saveRenewalSettingsAction({ due_day: day, target_pct: pct });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <TargetIcon /> Target
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="renew-pct">Share (%)</Label>
            <Input id="renew-pct" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="renew-day">By day</Label>
            <Input id="renew-day" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
        </div>
        <Button size="sm" className="w-full" onClick={save} disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}
          Save target
        </Button>
      </PopoverContent>
    </Popover>
  );
}
