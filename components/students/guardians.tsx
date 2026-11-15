"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon, PhoneIcon, PlusIcon, Trash2Icon, UsersIcon } from "lucide-react";
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteGuardianAction, saveGuardianAction } from "@/lib/actions/students";
import { concessionGuardianSchema, type ConcessionGuardianInput } from "@/lib/core/validation";
import { RELATIONSHIP_LABEL } from "@/lib/students/rules";
import type { StudentDetail } from "@/lib/students/queries";

type Guardian = StudentDetail["guardians"][number];

function GuardianDialog({ studentId, guardian, children }: { studentId: string; guardian?: Guardian; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const start: ConcessionGuardianInput = guardian
    ? {
        id: guardian.id,
        student_id: studentId,
        relationship: guardian.relationship,
        full_name: guardian.fullName,
        occupation: guardian.occupation,
        phone: guardian.phone ?? "",
      }
    : { student_id: studentId, relationship: "mother", full_name: "", occupation: "", phone: "" };
  const form = useForm<ConcessionGuardianInput>({ resolver: zodResolver(concessionGuardianSchema), defaultValues: start });

  const onSubmit = (values: ConcessionGuardianInput) =>
    startTransition(async () => {
      const result = await saveGuardianAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) form.reset(start);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{guardian ? "Edit parent / guardian" : "Add parent / guardian"}</DialogTitle>
          <DialogDescription>Their occupation is needed before the student can be verified.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="relationship"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Who</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(Object.keys(RELATIONSHIP_LABEL) as (keyof typeof RELATIONSHIP_LABEL)[]).map((r) => (
                        <SelectItem key={r} value={r}>
                          {RELATIONSHIP_LABEL[r]}
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
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="occupation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Occupation</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Farmer, Driver, No job" {...field} />
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
                  <FormLabel>Phone (optional)</FormLabel>
                  <FormControl>
                    <Input type="tel" inputMode="tel" placeholder="0771234567" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>{guardian ? "Save" : "Add"}</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function Guardians({ studentId, guardians, canEdit }: { studentId: string; guardians: Guardian[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const remove = (g: Guardian) =>
    startTransition(async () => {
      const result = await deleteGuardianAction({ id: g.id, student_id: studentId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {guardians.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <UsersIcon className="size-4" /> No parent or guardian added yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {guardians.map((g) => (
            <li key={g.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {g.fullName} <span className="text-muted-foreground font-normal">· {RELATIONSHIP_LABEL[g.relationship]}</span>
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {g.occupation}
                  {g.phone && (
                    <>
                      {" · "}
                      <PhoneIcon className="inline size-3" /> {g.phone}
                    </>
                  )}
                </p>
              </div>
              {canEdit && (
                <>
                  <GuardianDialog studentId={studentId} guardian={g}>
                    <Button variant="ghost" size="icon" aria-label={`Edit ${g.fullName}`}>
                      <PencilIcon />
                    </Button>
                  </GuardianDialog>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground"
                    aria-label={`Remove ${g.fullName}`}
                    disabled={pending}
                    onClick={() => remove(g)}
                  >
                    <Trash2Icon />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <GuardianDialog studentId={studentId}>
          <Button variant="outline" size="sm">
            <PlusIcon /> Add parent / guardian
          </Button>
        </GuardianDialog>
      )}
    </div>
  );
}
