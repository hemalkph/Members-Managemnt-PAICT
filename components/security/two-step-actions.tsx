"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon, RotateCcwKeyIcon, ShieldOffIcon } from "lucide-react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { disableTwoStepAction, resetTwoStepAction } from "@/lib/actions/two-step";

function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  icon: Icon,
  run,
  size,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  icon: typeof ShieldOffIcon;
  run: () => Promise<{ ok: boolean; error?: string; message?: string }>;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const go = () =>
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(result.message ?? "Done");
      setOpen(false);
      router.refresh();
    });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size={size}>
          <Icon /> {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={go} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <Icon />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DisableTwoStepButton() {
  return (
    <ConfirmButton
      label="Turn off"
      title="Turn off two-step login?"
      description="You will only need your password to log in. Anyone who learns your password could then get into your account."
      confirmLabel="Turn off"
      icon={ShieldOffIcon}
      run={disableTwoStepAction}
    />
  );
}

export function ResetTwoStepButton({ userId, name }: { userId: string; name: string }) {
  return (
    <ConfirmButton
      size="sm"
      label="Reset"
      title={`Reset two-step login for ${name}?`}
      description={`Use this if ${name} lost their phone. Their authenticator is removed; they log in with just their password and set it up again. This is recorded in the activity log.`}
      confirmLabel="Reset"
      icon={RotateCcwKeyIcon}
      run={() => resetTwoStepAction({ userId })}
    />
  );
}
