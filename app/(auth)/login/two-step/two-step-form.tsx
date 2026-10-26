"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { toast } from "sonner";
import { SubmitButton } from "@/components/submit-button";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { verifyLoginCodeAction } from "@/lib/actions/two-step";

export function TwoStepLoginForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (value: string) =>
    startTransition(async () => {
      setError(null);
      const result = await verifyLoginCodeAction({ code: value });
      if (!result.ok) {
        setError(result.error);
        setCode("");
        return;
      }
      toast.success("Logged in");
      router.replace(result.data?.redirectTo ?? "/");
      router.refresh();
    });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) submit(code);
      }}
    >
      <div className="grid justify-center gap-2">
        <InputOTP
          maxLength={6}
          pattern={REGEXP_ONLY_DIGITS}
          value={code}
          onChange={(v) => {
            setCode(v);
            setError(null);
          }}
          onComplete={submit}
          disabled={pending}
          autoFocus
          aria-label="6-digit code"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "code-error" : undefined}
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
          <p id="code-error" role="alert" className="text-destructive max-w-72 text-center text-sm">
            {error}
          </p>
        )}
      </div>
      <SubmitButton pending={pending} className="w-full" disabled={pending || code.length !== 6}>
        Verify
      </SubmitButton>
      <p className="text-muted-foreground text-center text-xs">
        Lost your phone? Ask a main admin to reset your two-step login.{" "}
        <a href="/auth/signout" className="text-primary font-medium hover:underline">
          Log out
        </a>
      </p>
    </form>
  );
}
