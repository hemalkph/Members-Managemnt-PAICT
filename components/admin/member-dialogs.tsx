"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { useForm, useWatch, type Control, type FieldValues, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangleIcon, MailIcon, KeyRoundIcon } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createMemberAction, updateMemberAction } from "@/lib/actions/admin";
import {
  memberCreateSchema,
  memberUpdateSchema,
  type MemberCreateInput,
  type MemberUpdateInput,
} from "@/lib/validation";

type CommonFields = {
  full_name: string;
  phone: string;
  whatsapp: string;
  nic: string;
  role_ids: string[];
  is_admin: boolean;
};

/** Fields shared by the add and edit forms. */
function MemberFields<T extends FieldValues & CommonFields>({
  control,
  roleOptions,
}: {
  control: Control<T>;
  roleOptions: MultiSelectOption[];
}) {
  const name = (n: keyof CommonFields) => n as Path<T>;
  return (
    <>
      <FormField
        control={control}
        name={name("full_name")}
        render={({ field }) => (
          <FormItem className="sm:col-span-2">
            <FormLabel>Full name</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={name("phone")}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Phone</FormLabel>
            <FormControl>
              <Input type="tel" inputMode="tel" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={name("whatsapp")}
        render={({ field }) => (
          <FormItem>
            <FormLabel>WhatsApp</FormLabel>
            <FormControl>
              <Input type="tel" inputMode="tel" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={name("nic")}
        render={({ field }) => (
          <FormItem className="sm:col-span-2">
            <FormLabel>NIC (optional)</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={name("role_ids")}
        render={({ field, fieldState }) => (
          <FormItem className="sm:col-span-2">
            <FormLabel>Roles</FormLabel>
            <MultiSelect
              options={roleOptions}
              value={field.value as string[]}
              onChange={field.onChange}
              placeholder="Choose one or more roles"
              aria-invalid={Boolean(fieldState.error)}
            />
            <FormDescription>A member can have several roles across sections.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={name("is_admin")}
        render={({ field }) => (
          <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3 sm:col-span-2">
            <div className="space-y-0.5">
              <FormLabel>Admin access</FormLabel>
              <FormDescription>Admins can manage members and review all work.</FormDescription>
            </div>
            <FormControl>
              <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )}
      />
    </>
  );
}

export function AddMemberDialog({
  roleOptions,
  canCreate,
  children,
}: {
  roleOptions: MultiSelectOption[];
  canCreate: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const empty: MemberCreateInput = {
    email: "",
    full_name: "",
    phone: "",
    whatsapp: "",
    nic: "",
    role_ids: [],
    is_admin: false,
    mode: "invite",
    password: "",
  };
  const form = useForm<MemberCreateInput>({ resolver: zodResolver(memberCreateSchema), defaultValues: empty });
  const mode = useWatch({ control: form.control, name: "mode" });

  const onSubmit = (values: MemberCreateInput) =>
    startTransition(async () => {
      const result = await createMemberAction(values);
      if (!result.ok) {
        toast.error(result.error);
        if (result.fieldErrors?.email?.[0]) form.setError("email", { message: result.fieldErrors.email[0] });
        return;
      }
      toast.success(result.message);
      form.reset(empty);
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>Invite by email, or create the account with a temporary password.</DialogDescription>
        </DialogHeader>
        {!canCreate && (
          <div className="bg-warning/15 flex gap-2 rounded-lg p-3 text-sm">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-warning" />
            <p>
              <code>SUPABASE_SERVICE_ROLE_KEY</code> is not set on the server, so new accounts can&apos;t be created yet.
            </p>
          </div>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Tabs
              value={mode}
              onValueChange={(v) => form.setValue("mode", v as MemberCreateInput["mode"])}
              className="sm:col-span-2"
            >
              <TabsList className="w-full">
                <TabsTrigger value="invite">
                  <MailIcon /> Send invite email
                </TabsTrigger>
                <TabsTrigger value="password">
                  <KeyRoundIcon /> Set a password
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {mode === "password" && (
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Temporary password</FormLabel>
                    <FormControl>
                      <Input type="text" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormDescription>Share it privately. They can change it with “Forgot password”.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <MemberFields control={form.control} roleOptions={roleOptions} />
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pending={pending} disabled={!canCreate}>
                {mode === "invite" ? "Send invite" : "Create member"}
              </SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function EditMemberDialog({
  member,
  roleOptions,
  open,
  onOpenChange,
}: {
  member: MemberUpdateInput & { email: string };
  roleOptions: MultiSelectOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { email, ...defaults } = member;
  const form = useForm<MemberUpdateInput>({ resolver: zodResolver(memberUpdateSchema), defaultValues: defaults });

  const onSubmit = (values: MemberUpdateInput) =>
    startTransition(async () => {
      const result = await updateMemberAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      onOpenChange(false);
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) form.reset(defaults);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
          <DialogDescription>{email}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
            <MemberFields control={form.control} roleOptions={roleOptions} />
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>Save</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
