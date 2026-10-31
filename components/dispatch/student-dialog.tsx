"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveStudentAction } from "@/lib/actions/dispatch";
import { studentSchema, type StudentInput } from "@/lib/validation";

import { useT } from "@/components/dispatch/lang";
export type BatchOption = { id: string; name: string };

const TEXT_FIELDS: { name: keyof StudentInput; label: string; wide?: boolean; type?: string; hint?: string }[] = [
  { name: "address_line1", label: "Address line 1", wide: true },
  { name: "address_line2", label: "Address line 2", wide: true },
  { name: "address_line3", label: "Address line 3", wide: true },
  { name: "city", label: "City" },
  { name: "region", label: "Region (optional)" },
  { name: "phone1", label: "Phone 1", type: "tel", hint: "e.g. 0771234567" },
  { name: "phone2", label: "Phone 2 (optional)", type: "tel" },
];

/** Add or edit one student's delivery details. */
export function StudentDialog({
  student,
  batches,
  children,
}: {
  student?: StudentInput;
  batches: BatchOption[];
  children: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const empty: StudentInput = {
    id: "",
    batch_id: batches[0]?.id ?? "",
    student_no: "",
    full_name: "",
    address_line1: "",
    address_line2: "",
    address_line3: "",
    city: "",
    region: "",
    phone1: "",
    phone2: "",
    delivery_note: "",
    expected_updated_at: "",
  };
  const defaults = student ?? empty;
  const form = useForm<StudentInput>({ resolver: zodResolver(studentSchema), defaultValues: defaults });
  const editing = Boolean(student?.id);

  const onSubmit = (values: StudentInput) =>
    startTransition(async () => {
      const result = await saveStudentAction(values);
      if (!result.ok) {
        toast.error(t(result.error));
        return;
      }
      toast.success(t(result.message));
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) form.reset(defaults);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t("Edit student") : t("Add student")}</DialogTitle>
          <DialogDescription>{t("Delivery details for tute parcels. Students never log in.")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
            <FormField
              control={form.control}
              name="batch_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("Batch")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={editing}>
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
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="student_no"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("Student number")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="088" autoComplete="off" />
                  </FormControl>
                  <FormDescription>{t("Leading zeros are kept.")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>{t("Name")}</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {TEXT_FIELDS.map((f) => (
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
                        type={f.type ?? "text"}
                        inputMode={f.type === "tel" ? "tel" : undefined}
                        autoComplete="off"
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
              name="delivery_note"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>{t("Delivery note (optional)")}</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} placeholder={t("e.g. Call before delivering")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("Cancel")}
              </Button>
              <SubmitButton pending={pending}>{editing ? t("Save") : t("Add student")}</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
