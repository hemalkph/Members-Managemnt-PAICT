"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon, MoreHorizontalIcon, RotateCcwIcon, Trash2Icon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setPaperStatusAction } from "@/lib/actions/papers";

/** Admins: cancel / restart / delete a paper. */
export function PaperActions({ paperId, title, status }: { paperId: string; title: string; status: string }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (next: "cancelled" | "in_progress" | "deleted") =>
    startTransition(async () => {
      const result = await setPaperStatusAction({ id: paperId, status: next });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      if (next === "deleted") router.push("/admin/papers");
      else router.refresh();
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Paper actions" disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <MoreHorizontalIcon />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {status === "cancelled" ? (
            <DropdownMenuItem onSelect={() => run("in_progress")}>
              <RotateCcwIcon /> Restart
            </DropdownMenuItem>
          ) : (
            status === "in_progress" && (
              <DropdownMenuItem onSelect={() => run("cancelled")}>
                <XCircleIcon /> Cancel paper
              </DropdownMenuItem>
            )
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2Icon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its stages, stage tasks and all uploaded files are deleted. Logged work stays. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={pending} onClick={() => run("deleted")}>
              Delete paper
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
