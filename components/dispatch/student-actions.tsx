"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { MoreHorizontalIcon, PencilIcon, UserCheckIcon, UserXIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setStudentActiveAction } from "@/lib/actions/dispatch";
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
