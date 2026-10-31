"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon, UserCheckIcon, UserXIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteStudentAction, setStudentActiveAction } from "@/lib/actions/dispatch";
import type { StudentInput } from "@/lib/validation";
import { StudentDialog, type BatchOption } from "./student-dialog";

import { useT } from "@/components/dispatch/lang";
export function StudentActions({
  student,
  active,
  batches,
}: {
  student: StudentInput;
  active: boolean;
  batches: BatchOption[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = () =>
    startTransition(async () => {
      const result = await deleteStudentAction({ id: student.id! });
      setConfirmDelete(false);
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
      router.refresh();
    });
  const toggle = () =>
    startTransition(async () => {
      const result = await setStudentActiveAction({ id: student.id, active: !active });
      if (!result.ok) {
        toast.error(t(result.error));
        return;
      }
      toast.success(t(result.message));
      router.refresh();
    });

  return (
    <div className="flex items-center justify-end gap-1">
      <StudentDialog student={student} batches={batches}>
        <Button variant="ghost" size="icon-sm" aria-label={t("Edit {no}", { no: student.student_no })}>
          <PencilIcon />
        </Button>
      </StudentDialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("More for {no}", { no: student.student_no })}
            disabled={pending}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={toggle}>
            {active ? <UserXIcon /> : <UserCheckIcon />} {active ? t("Mark inactive") : t("Mark active")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-destructive">
            <Trash2Icon /> {t("Delete…")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete {name}?", { name: student.full_name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Their name, address and phone are removed for good. A student who is already in a sent round can't be deleted – mark them inactive instead.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Keep")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                remove();
              }}
              disabled={pending}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              {t("Delete student")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
