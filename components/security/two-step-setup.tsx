"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { CheckIcon, CopyIcon, Loader2Icon, QrCodeIcon, ShieldCheckIcon, SmartphoneIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { confirmTwoStepSetupAction, startTwoStepSetupAction } from "@/lib/actions/two-step";

type Enrolment = { factorId: string; qrCode: string; secret: string };

/** Turn on two-step login: scan the QR code, then enter the first code. */
export function TwoStepSetup() {
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const start = () =>
    startTransition(async () => {
      const result = await startTwoStepSetupAction();
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Could not start the set-up." : result.error);
        return;
      }
      setEnrolment(result.data);
    });

  const confirm = (value: string) => {
    if (!enrolment) return;
    startTransition(async () => {
      setError(null);
      const result = await confirmTwoStepSetupAction({ factorId: enrolment.factorId, code: value });
      if (!result.ok) {
        setError(result.error);
        setCode("");
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  };

  const copySecret = async () => {
    if (!enrolment) return;
    try {
      await navigator.clipboard.writeText(enrolment.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy. Select the key and copy it by hand.");
    }
  };

  if (!enrolment) {
    return (
      <div className="space-y-4">
        <ol className="text-muted-foreground grid gap-3 text-sm">
          <li className="flex gap-3">
            <SmartphoneIcon className="text-primary mt-0.5 size-4 shrink-0" />
            <span>
              Install an authenticator app on your phone, e.g. <strong className="text-foreground">Google Authenticator</strong>{" "}
              or <strong className="text-foreground">Microsoft Authenticator</strong> (free).
            </span>
          </li>
          <li className="flex gap-3">
            <QrCodeIcon className="text-primary mt-0.5 size-4 shrink-0" />
            <span>Press the button below and scan the QR code with the app.</span>
          </li>
          <li className="flex gap-3">
            <ShieldCheckIcon className="text-primary mt-0.5 size-4 shrink-0" />
            <span>Enter the 6-digit code the app shows. From then on you enter a new code each time you log in.</span>
          </li>
        </ol>
        <Button onClick={start} disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
          Set up two-step login
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-start">
      <div className="mx-auto space-y-2 text-center md:mx-0">
        <div className="rounded-xl border bg-white p-3 shadow-sm">
          {/* The QR code is an SVG data URL from Supabase. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrolment.qrCode} alt="QR code to scan with your authenticator app" className="size-44" />
        </div>
        <p className="text-muted-foreground text-xs">Scan with your authenticator app</p>
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Can&apos;t scan? Type this key into the app</p>
          <div className="flex items-center gap-2">
            <code className="bg-muted min-w-0 flex-1 rounded-md px-3 py-2 font-mono text-xs break-all select-all">
              {enrolment.secret}
            </code>
            <Button variant="outline" size="icon" onClick={copySecret} aria-label="Copy key">
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
        </div>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) confirm(code);
          }}
        >
          <p className="text-sm font-medium" id="setup-code-label">
            Enter the 6-digit code from the app
          </p>
          <InputOTP
            maxLength={6}
            pattern={REGEXP_ONLY_DIGITS}
            value={code}
            onChange={(v) => {
              setCode(v);
              setError(null);
            }}
            onComplete={confirm}
            disabled={pending}
            autoFocus
            aria-labelledby="setup-code-label"
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} aria-invalid={error ? true : undefined} />
              <InputOTPSlot index={1} aria-invalid={error ? true : undefined} />
              <InputOTPSlot index={2} aria-invalid={error ? true : undefined} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} aria-invalid={error ? true : undefined} />
              <InputOTPSlot index={4} aria-invalid={error ? true : undefined} />
              <InputOTPSlot index={5} aria-invalid={error ? true : undefined} />
            </InputOTPGroup>
          </InputOTP>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={pending || code.length !== 6}>
              {pending ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
              Turn on
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEnrolment(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
