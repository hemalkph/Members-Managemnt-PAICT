"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { SubmitButton } from "@/components/submit-button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { saveBankDetailsAction } from "@/lib/actions/bank";
import { maskAccountNumber } from "@/lib/format";
import { bankSchema, type BankInput } from "@/lib/validation";

export function BankForm({
  defaultValues,
  hasExisting,
  last4,
}: {
  defaultValues: BankInput;
  hasExisting: boolean;
  last4: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<BankInput>({ resolver: zodResolver(bankSchema), defaultValues });

  const onSubmit = (values: BankInput) => {
    if (!hasExisting && !values.account_number.trim()) {
      form.setError("account_number", { message: "Enter your account number" });
      return;
    }
    startTransition(async () => {
      const result = await saveBankDetailsAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      form.reset({ ...values, account_number: "" });
      router.refresh();
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <FormField
          control={form.control}
          name="bank_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bank name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Bank of Ceylon" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="branch"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Branch</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Kandy" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="account_holder"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Account holder name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="account_number"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Account number</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={last4 ? `${maskAccountNumber(last4)} (saved)` : "Digits only"}
                  {...field}
                />
              </FormControl>
              {hasExisting && <FormDescription>Leave empty to keep the saved number.</FormDescription>}
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="sm:col-span-2">
          <SubmitButton pending={pending} className="w-full sm:w-auto">
            Save bank details
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
