"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon, PiggyBankIcon } from "lucide-react";
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
import { updateMonthlyBudgetAction } from "@/lib/actions/settings";

export function BudgetDialog({ budget }: { budget: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(budget || ""));
  const [pending, startTransition] = useTransition();

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    startTransition(async () => {
      const result = await updateMonthlyBudgetAction({ monthly_budget: amount });
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
        if (next) setValue(String(budget || ""));
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PiggyBankIcon /> {budget > 0 ? "Change budget" : "Set monthly budget"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Monthly budget</DialogTitle>
          <DialogDescription>How much the team can spend on paid work each month.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="monthly-budget">Amount (Rs.)</Label>
            <Input
              id="monthly-budget"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Save budget
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
