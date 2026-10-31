"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { SubmitButton } from "@/components/submit-button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveRoundAction } from "@/lib/actions/dispatch-rounds";
import { roundSchema, type RoundInput } from "@/lib/validation";

import { useT } from "@/components/dispatch/lang";
type Field = { name: keyof RoundInput; label: string; type?: string; hint?: string; placeholder?: string };

const FIELDS: Field[] = [
  { name: "sending_month", label: "Sending month", type: "month" },
  { name: "group_label", label: "Group (optional)", placeholder: "e.g. Theory" },
  { name: "subject", label: "Subject (optional)", placeholder: "e.g. ICT" },
  {
    name: "ref_prefix",
    label: "Reference prefix",
    placeholder: "27TGNOVICT",
    hint: "Each parcel's reference is this plus the student number, e.g. 27TGNOVICT088. Use a new prefix every round.",
  },
  { name: "default_cod", label: "Default COD (Rs.)", type: "number", hint: "Can be changed per student" },
  { name: "default_weight_g", label: "Weight (g)", type: "number" },
  { name: "default_pieces", label: "Pieces", type: "number" },
  { name: "planned_handover", label: "Planned handover (optional)", type: "date" },
];

/** Round details: used to create a round and to edit a draft. */
export function RoundForm({
  values,
  batches,
  lockBatch = false,
  onSaved,
}: {
  values: RoundInput;
  batches: { id: string; name: string }[];
  lockBatch?: boolean;
  onSaved?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<RoundInput>({ resolver: zodResolver(roundSchema), defaultValues: values });

  const onSubmit = (v: RoundInput) =>
    startTransition(async () => {
      const result = await saveRoundAction(v);
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
      if (!v.id) router.push(`/admin/dispatch/rounds/${result.data!.id}?step=tutes`);
      else {
        onSaved?.();
        router.refresh();
      }
    });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>{t("Round name")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t("November – 2027 Theory")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="batch_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("Batch")}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange} disabled={lockBatch}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("Choose a batch")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lockBatch && <FormDescription>{t("Remove the chosen students to change the batch.")}</FormDescription>}
              <FormMessage />
            </FormItem>
          )}
        />
        {FIELDS.map((f) => (
          <FormField
            key={f.name}
            control={form.control}
            name={f.name}
            render={({ field }) => (
              <FormItem className={f.name === "ref_prefix" ? "sm:col-span-2" : undefined}>
                <FormLabel>{t(f.label)}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value === undefined || field.value === null ? "" : String(field.value)}
                    type={f.type ?? "text"}
                    placeholder={f.placeholder}
                    className={f.name === "ref_prefix" ? "font-mono uppercase" : undefined}
                  />
                </FormControl>
                {f.hint && <FormDescription>{t(f.hint)}</FormDescription>}
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>{t("Notes (optional)")}</FormLabel>
              <FormControl>
                <Textarea {...field} rows={2} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="sm:col-span-2">
          <SubmitButton pending={pending}>{values.id ? t("Save details") : t("Create round")}</SubmitButton>
        </div>
      </form>
    </Form>
  );
}
