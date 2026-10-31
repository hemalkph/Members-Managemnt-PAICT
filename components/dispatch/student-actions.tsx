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

export function StudentActions({
  student,
  active,
  batches,
}: {
  student: StudentInput;
  active: boolean;
  batches: BatchOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toggle = () =>
    startTransition(async () => {
      const result = await setStudentActiveAction({ id: student.id, active: !active });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  return (
    <div className="flex items-center justify-end gap-1">
      <StudentDialog student={student} batches={batches}>
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${student.student_no}`}>
          <PencilIcon />
        </Button>
      </StudentDialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`More for ${student.student_no}`} disabled={pending}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={toggle}>
            {active ? <UserXIcon /> : <UserCheckIcon />} {active ? "Mark inactive" : "Mark active"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
