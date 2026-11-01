"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LockIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { closeMonthAction } from "@/lib/actions/payments";
import { formatLKR } from "@/lib/format";

export function CloseMonthDialog({
  month,
  monthLabel,
  members,
  total,
  disabled,
}: {
  month: string;
  monthLabel: string;
  members: number;
  total: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const close = () =>
    startTransition(async () => {
      const result = await closeMonthAction({ month, note });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      setNote("");
      router.refresh();
    });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button disabled={disabled}>
          <LockIcon /> Close {monthLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close {monthLabel} for payments?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                This creates payslips for <strong className="text-foreground">{members}</strong> member
                {members === 1 ? "" : "s"} (about <strong className="text-foreground">{formatLKR(total)}</strong>) using
                today&apos;s salaries and the locked prices of approved work.
              </p>
              <p>
                Approved work for {monthLabel} is locked afterwards. Work that isn&apos;t approved yet moves to the next
                month. You can reopen the month as long as nobody is marked as paid.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="close-note">Note (optional)</Label>
          <Textarea
            id="close-note"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Pay by 5 November through BOC"
            rows={2}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button onClick={close} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <LockIcon />}
            Close month
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
