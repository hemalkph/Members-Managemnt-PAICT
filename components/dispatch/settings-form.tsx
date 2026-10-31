"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveDispatchSettingsAction } from "@/lib/actions/dispatch";
import { dispatchSettingsSchema, type DispatchSettingsInput } from "@/lib/validation";

type Field = { name: keyof DispatchSettingsInput; label: string; hint?: string; type?: string; wide?: boolean };

const SENDER: Field[] = [
  { name: "sender_name", label: "Sender name", wide: true, hint: "As registered with the courier" },
  { name: "sender_line1", label: "Address line 1", wide: true },
  { name: "sender_line2", label: "Address line 2" },
  { name: "sender_line3", label: "Address line 3" },
  { name: "sender_city", label: "City" },
  { name: "sender_contact_name", label: "Contact name" },
  { name: "sender_phone1", label: "Phone 1", type: "tel", hint: "e.g. 0711234567" },
  { name: "sender_phone2", label: "Phone 2", type: "tel" },
];

const DEFAULTS: Field[] = [
  { name: "default_cod", label: "Default COD (Rs.)", type: "number", hint: "Can be changed per student in a round" },
  { name: "default_weight_g", label: "Default weight (g)", type: "number" },
  { name: "default_pieces", label: "Pieces per parcel", type: "number" },
];

const RETENTION: Field[] = [
  { name: "student_retention_months", label: "Anonymise students after (months)", type: "number", hint: "After the batch's last closed round" },
  { name: "recipient_retention_days", label: "Anonymise parcel addresses after (days)", type: "number", hint: "After the round closes" },
  { name: "courier_file_retention_days", label: "Delete courier files after (days)", type: "number", hint: "After the round closes" },
  { name: "import_file_retention_days", label: "Delete import files after (days)", type: "number", hint: "After upload" },
];

export function DispatchSettingsForm({
  values,
  canEditDetails,
  canEditPolicy,
}: {
  values: DispatchSettingsInput;
  canEditDetails: boolean;
  canEditPolicy: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<DispatchSettingsInput>({ resolver: zodResolver(dispatchSettingsSchema), defaultValues: values });

  const onSubmit = (v: DispatchSettingsInput) =>
    startTransition(async () => {
      const result = await saveDispatchSettingsAction(v);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      router.refresh();
    });

  const renderField = (f: Field, disabled: boolean) => (
    <FormField
      key={f.name}
      control={form.control}
      name={f.name}
      render={({ field }) => (
        <FormItem className={f.wide ? "sm:col-span-2" : undefined}>
          <FormLabel>{f.label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              value={field.value === undefined || field.value === null ? "" : String(field.value)}
              type={f.type ?? "text"}
              inputMode={f.type === "number" ? "numeric" : f.type === "tel" ? "tel" : undefined}
              disabled={disabled}
            />
          </FormControl>
          {f.hint && <FormDescription>{f.hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>Sender</CardTitle>
            <CardDescription>Used on courier files. Nothing personal is hard-coded in the app.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">{SENDER.map((f) => renderField(f, !canEditDetails))}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Parcel defaults</CardTitle>
            <CardDescription>Starting values for new dispatch rounds.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">{DEFAULTS.map((f) => renderField(f, !canEditDetails))}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Checks and privacy</CardTitle>
            <CardDescription>
              Only main admins (with two-step login) can change these. Retention runs automatically every night.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="require_verification"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3 sm:col-span-2">
                  <div className="space-y-0.5">
                    <FormLabel>Second-person verification</FormLabel>
                    <FormDescription>A different person checks each packed parcel before handover.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={!canEditPolicy} />
                  </FormControl>
                </FormItem>
              )}
            />
            {RETENTION.map((f) => renderField(f, !canEditPolicy))}
          </CardContent>
        </Card>

        {(canEditDetails || canEditPolicy) && <SubmitButton pending={pending}>Save settings</SubmitButton>}
      </form>
    </Form>
  );
}
