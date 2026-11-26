"use client";

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setReviewLimitAction } from "@/lib/actions/admin";

/** "Review within [24] hours": the limit the reminders and waiting chips use. */
export function ReviewLimitForm({ hours }: { hours: number }) {
  const [value, setValue] = useState(String(hours));
  const [pending, startTransition] = useTransition();
  const changed = Number(value) !== hours;

  const save = () =>
    startTransition(async () => {
      const result = await setReviewLimitAction(Number(value));
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });

  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Label htmlFor="review-limit">Review within</Label>
      <Input
        id="review-limit"
        type="number"
        inputMode="numeric"
        min={1}
        max={168}
        className="h-8 w-20"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <span className="text-muted-foreground">hours</span>
      {changed && (
        <Button type="submit" size="sm" disabled={pending || value === ""}>
          {pending && <Loader2Icon className="animate-spin" />} Save
        </Button>
      )}
    </form>
  );
}
