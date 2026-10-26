"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { SubmitButton } from "@/components/submit-button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { signInAction } from "@/lib/actions/auth";
import { loginSchema, type LoginInput } from "@/lib/validation";

export function LoginForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (initialError) toast.error(initialError);
  }, [initialError]);

  const onSubmit = (values: LoginInput) =>
    startTransition(async () => {
      const result = await signInAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Logged in");
      router.replace(result.data?.redirectTo ?? "/");
      router.refresh();
    });

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
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Password</FormLabel>
                <Link href="/forgot-password" className="text-primary text-xs font-medium hover:underline">
                  Forgot password?
                </Link>
              </div>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitButton pending={pending} className="w-full">
          Log in
        </SubmitButton>
        <p className="text-muted-foreground text-center text-xs">
          No account yet? Ask a team admin to invite you.
        </p>
      </form>
    </Form>
  );
}
