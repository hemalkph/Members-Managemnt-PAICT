"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CakeIcon } from "lucide-react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/submit-button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { updateProfileAction } from "@/lib/actions/profile";
import { formatDate } from "@/lib/format";
import { parseNic } from "@/lib/nic";
import { profileSchema, type ProfileInput } from "@/lib/validation";

export function ProfileForm({ defaultValues }: { defaultValues: ProfileInput }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<ProfileInput>({ resolver: zodResolver(profileSchema), defaultValues });
  const nicValue = useWatch({ control: form.control, name: "nic" });
  const nicInfo = parseNic(nicValue);

  const onSubmit = (values: ProfileInput) =>
    startTransition(async () => {
      const result = await updateProfileAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      form.reset(values);
      router.refresh();
    });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <FormField
          control={form.control}
          name="full_name"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone number</FormLabel>
              <FormControl>
                <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="07X XXX XXXX" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="whatsapp"
          render={({ field }) => (
            <FormItem>
              <FormLabel>WhatsApp number</FormLabel>
              <FormControl>
                <Input type="tel" inputMode="tel" placeholder="07X XXX XXXX" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="nic"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>NIC</FormLabel>
              <FormControl>
                <Input autoCapitalize="characters" placeholder="200212345678 or 991234567V" {...field} />
              </FormControl>
              {nicInfo ? (
                <p className="text-primary flex items-center gap-1.5 text-sm font-medium">
                  <CakeIcon className="size-4" /> Birthday: {formatDate(nicInfo.dateOfBirth)}
                </p>
              ) : (
                <FormDescription>Your birthday is read from your NIC. Only you and admins can see it.</FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="sm:col-span-2">
          <SubmitButton pending={pending} disabled={!form.formState.isDirty} className="w-full sm:w-auto">
            Save changes
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
