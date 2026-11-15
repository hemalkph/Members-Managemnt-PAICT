"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LockIcon } from "lucide-react";
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
import { saveConcessionStudentAction } from "@/lib/actions/students";
import { concessionStudentSchema, type ConcessionStudentInput } from "@/lib/core/validation";
import { CARD_HINT, CARD_LABEL, CARD_TYPES } from "@/lib/students/rules";

type Option = { id: string; name: string };

/** Register a student, or (with `student`) edit their details. The card type is changed with the card dialog. */
export function StudentDialog({
  student,
  batches,
  centres,
  children,
}: {
  student?: ConcessionStudentInput;
  batches: Option[];
  centres: Option[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const empty: ConcessionStudentInput = {
    student_no: "",
    full_name: "",
    batch_id: batches[0]?.id ?? "",
    centre_id: "",
    card_type: "free",
    gn_division: "",
    certificate_issued_on: "",
    reason: "",
    monthly_amount: "",
    consent_on: "",
  };
  const form = useForm<ConcessionStudentInput>({
    resolver: zodResolver(concessionStudentSchema),
    defaultValues: student ?? empty,
  });
  const card = useWatch({ control: form.control, name: "card_type" });

  const onOpenChange = (next: boolean) => {
    if (next) form.reset(student ?? empty);
    setOpen(next);
  };

  const onSubmit = (values: ConcessionStudentInput) =>
    startTransition(async () => {
      const result = await saveConcessionStudentAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      if (!student && result.data) router.push(`/admin/students/${result.data.id}`);
      else router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{student ? "Edit student" : "Register a concession student"}</DialogTitle>
          <DialogDescription>
            {student
              ? "Change the student's details. Use “Change card” to change the card type or status."
              : "Add what you have now. The student stays Applied until the GN certificate, parents and consent are in."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
            <FormField
              control={form.control}
              name="student_no"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Student ID</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" className="uppercase" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Student name</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" {...field} />
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
                  <FormLabel>Batch</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a batch" />
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
              name="centre_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Centre (optional)</FormLabel>
                  <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">No centre</SelectItem>
                      {centres.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {!student && (
              <FormField
                control={form.control}
                name="card_type"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Card type</FormLabel>
                    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Card type">
                      {CARD_TYPES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={field.value === c}
                          onClick={() => field.onChange(c)}
                          className={
                            field.value === c
                              ? "border-primary bg-primary/5 ring-primary/30 rounded-lg border p-3 text-left ring-2"
                              : "hover:bg-muted/50 rounded-lg border p-3 text-left"
                          }
                        >
                          <span className="block text-sm font-medium">{CARD_LABEL[c]}</span>
                          <span className="text-muted-foreground block text-xs">{CARD_HINT[c]}</span>
                        </button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="text-muted-foreground flex items-center gap-2 border-t pt-3 text-xs sm:col-span-2">
              <LockIcon className="size-3.5" /> Private: only admins with this page can see the fields below.
            </div>
            <FormField
              control={form.control}
              name="gn_division"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>GN division</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. 628B Kotigamgoda, Horana" {...field} />
                  </FormControl>
                  <FormDescription>The number and name on the GN certificate.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="certificate_issued_on"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>GN certificate date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormDescription>Must be within the last 12 months.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {(student ? student.card_type !== "free" : card !== "free") && (
              <FormField
                control={form.control}
                name="monthly_amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly amount (Rs.)</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" placeholder="e.g. 1500" {...field} />
                    </FormControl>
                    <FormDescription>
                      {(student?.card_type ?? card) === "half" ? "Half of the batch fee." : "What the family agreed to pay."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="consent_on"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parents&apos; consent given on</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormDescription>The day the parents agreed to these details being kept.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Why the student gets this card</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>{student ? "Save" : "Register"}</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
