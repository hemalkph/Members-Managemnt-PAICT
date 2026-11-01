"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { ArrowRightIcon, LockIcon } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveDispatchSettingsAction } from "@/lib/actions/dispatch";
import { STAGE_LABEL, type OptionalStep, type StageKey } from "@/lib/dispatch/stages";
import { cn } from "@/lib/utils";
import { dispatchSettingsSchema, type DispatchSettingsInput } from "@/lib/validation";

import { useT } from "@/components/dispatch/lang";
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
  {
    name: "student_retention_months",
    label: "Anonymise students after (months)",
    type: "number",
    hint: "After the batch's last closed round",
  },
  {
    name: "recipient_retention_days",
    label: "Anonymise parcel addresses after (days)",
    type: "number",
    hint: "After the round closes",
  },
  {
    name: "courier_file_retention_days",
    label: "Delete courier files after (days)",
    type: "number",
    hint: "After the round closes",
  },
  {
    name: "import_file_retention_days",
    label: "Delete import files after (days)",
    type: "number",
    hint: "After upload",
  },
];

const STEP_CHOICES: { key: OptionalStep; hint: string }[] = [
  { key: "handover", hint: "Scan parcels into a handover sheet when Citypak collects them." },
  { key: "delivery", hint: "Track delivered, failed and returned parcels. Needs Handover." },
  { key: "money", hint: "Match Citypak's COD payments to parcels before closing. Needs Delivery." },
];
const ALL_STEPS: StageKey[] = ["plan", "tracking", "pack", "handover", "delivery", "money", "close"];

/** Turning a step on also turns on what it needs; turning one off also turns off what needs it. */
function toggleStep(steps: OptionalStep[], key: OptionalStep, on: boolean): OptionalStep[] {
  const order: OptionalStep[] = ["handover", "delivery", "money"];
  const i = order.indexOf(key);
  return on ? order.filter((k, j) => steps.includes(k) || j <= i) : order.filter((k, j) => steps.includes(k) && j < i);
}

export function DispatchSettingsForm({
  values,
  canEditDetails,
  canEditPolicy,
}: {
  values: DispatchSettingsInput;
  canEditDetails: boolean;
  canEditPolicy: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<DispatchSettingsInput>({ resolver: zodResolver(dispatchSettingsSchema), defaultValues: values });

  const steps = (useWatch({ control: form.control, name: "optional_steps" }) ?? []) as OptionalStep[];

  const onSubmit = (v: DispatchSettingsInput) =>
    startTransition(async () => {
      const result = await saveDispatchSettingsAction(v);
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
      router.refresh();
    });

  const renderField = (f: Field, disabled: boolean) => (
    <FormField
      key={f.name}
      control={form.control}
      name={f.name}
      render={({ field }) => (
        <FormItem className={f.wide ? "sm:col-span-2" : undefined}>
          <FormLabel>{t(f.label)}</FormLabel>
          <FormControl>
            <Input
              {...field}
              value={field.value === undefined || field.value === null ? "" : String(field.value)}
              type={f.type ?? "text"}
              inputMode={f.type === "number" ? "numeric" : f.type === "tel" ? "tel" : undefined}
              disabled={disabled}
            />
          </FormControl>
          {f.hint && <FormDescription>{t(f.hint)}</FormDescription>}
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
            <CardTitle>{t("Round steps")}</CardTitle>
            <CardDescription>
              {t(
                "Choose the steps your office uses. Plan, Tracking numbers, Pack and Close are always on. A round can be closed once every step that is on is finished.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="flex flex-wrap items-center gap-1.5" aria-label={t("Steps in use")}>
              {ALL_STEPS.filter((k) => !STEP_CHOICES.some((c) => c.key === k) || steps.includes(k as OptionalStep)).map(
                (k, i, list) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <span className="bg-primary/10 text-primary rounded-full px-2.5 py-1 text-xs font-semibold">
                      {i + 1}. {t(STAGE_LABEL[k])}
                    </span>
                    {i < list.length - 1 && <ArrowRightIcon className="text-muted-foreground size-3.5" aria-hidden />}
                  </li>
                ),
              )}
            </ol>
            <div className="divide-y rounded-lg border">
              {STEP_CHOICES.map((c) => (
                <label
                  key={c.key}
                  className={cn(
                    "flex min-h-14 items-center justify-between gap-4 px-3 py-2.5",
                    canEditPolicy && "cursor-pointer",
                  )}
                >
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{t(STAGE_LABEL[c.key])}</span>
                    <span className="text-muted-foreground block text-xs">{t(c.hint)}</span>
                  </span>
                  <Switch
                    checked={steps.includes(c.key)}
                    disabled={!canEditPolicy}
                    onCheckedChange={(on) =>
                      form.setValue("optional_steps", toggleStep(steps, c.key, on), { shouldDirty: true })
                    }
                  />
                </label>
              ))}
            </div>
            {!canEditPolicy && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <LockIcon className="size-3.5" /> {t("Only main admins (with two-step login) can change the steps.")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Sender")}</CardTitle>
            <CardDescription>{t("Used on courier files. Nothing personal is hard-coded in the app.")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {SENDER.map((f) => renderField(f, !canEditDetails))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Parcel defaults")}</CardTitle>
            <CardDescription>{t("Starting values for new dispatch rounds.")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {DEFAULTS.map((f) => renderField(f, !canEditDetails))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Checks and privacy")}</CardTitle>
            <CardDescription>
              {t("Only main admins (with two-step login) can change these. Retention runs automatically every night.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="require_verification"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3 sm:col-span-2">
                  <div className="space-y-0.5">
                    <FormLabel>{t("Second-person verification")}</FormLabel>
                    <FormDescription>
                      {t("A different person checks each packed parcel before handover.")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={!canEditPolicy} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="allow_self_verify"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3 sm:col-span-2">
                  <div className="space-y-0.5">
                    <FormLabel>{t("One-person mode")}</FormLabel>
                    <FormDescription>
                      {t(
                        "When only one person is packing, they may also verify their own parcels. Both scans still happen; switch this off when a second person joins.",
                      )}
                    </FormDescription>
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

        {(canEditDetails || canEditPolicy) && <SubmitButton pending={pending}>{t("Save settings")}</SubmitButton>}
      </form>
    </Form>
  );
}
