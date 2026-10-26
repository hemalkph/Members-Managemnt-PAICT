"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/submit-button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { forgotPasswordAction } from "@/lib/actions/auth";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validation";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = (values: ForgotPasswordInput) =>
    startTransition(async () => {
      const result = await forgotPasswordAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSent(true);
      toast.success(result.message);
    });

  if (sent) {
    return (
      <div className="bg-success/10 text-success flex items-start gap-3 rounded-lg p-4 text-sm">
        <MailCheckIcon className="mt-0.5 size-5 shrink-0" />
        <p>Check your inbox (and spam folder) for the reset link.</p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitButton pending={pending} className="w-full">
          Send reset link
        </SubmitButton>
      </form>
    </Form>
  );
}
