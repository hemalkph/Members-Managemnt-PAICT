"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon, LockOpenIcon } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { reopenMonthAction } from "@/lib/actions/payments";

export function ReopenMonthButton({
  month,
  monthLabel,
  hasPaid,
}: {
  month: string;
  monthLabel: string;
  hasPaid: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const reopen = () =>
    startTransition(async () => {
      const result = await reopenMonthAction({ month });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });

  if (hasPaid) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span so the tooltip works on a disabled button */}
          <span tabIndex={0}>
            <Button variant="outline" disabled>
              <LockOpenIcon /> Reopen
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Mark everyone as not paid before reopening</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <LockOpenIcon /> Reopen
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reopen {monthLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            The payslips for {monthLabel} are removed and work can be added, reviewed and changed again. Close the month
            again when you are ready. This is recorded in the activity log.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={reopen} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <LockOpenIcon />}
            Reopen month
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
