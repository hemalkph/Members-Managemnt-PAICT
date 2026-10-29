"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ClockIcon, KeyRoundIcon, MoreVerticalIcon, PencilIcon, UserCheckIcon, UserXIcon } from "lucide-react";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MultiSelectOption } from "@/components/ui/multi-select";
import { setMemberActiveAction } from "@/lib/actions/admin";
import { cn } from "@/lib/utils";
import type { MemberUpdateInput } from "@/lib/validation";
import { EditMemberDialog } from "./member-dialogs";
import { ResetPasswordDialog } from "./reset-password-dialog";

export type EditableMember = MemberUpdateInput & { email: string; is_active: boolean };

const ITEM = "py-2 text-[15px] sm:text-sm";

export function MemberActions({
  member,
  roleOptions,
  isSelf,
  canManageAuth,
  showView = true,
  variant = "menu",
  access,
}: {
  /** Page access, passed only when the viewer is a main admin (they can change it). */
  access?: { isMainAdmin: boolean; stored: unknown };
  member: EditableMember;
  roleOptions: MultiSelectOption[];
  isSelf: boolean;
  /** True when the server has the service role key (needed to reset passwords). */
  canManageAuth: boolean;
  showView?: boolean;
  variant?: "menu" | "buttons";
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { is_active, ...editable } = member;

  const toggleActive = () =>
    startTransition(async () => {
      const result = await setMemberActiveAction({ id: member.id, active: !is_active });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  return (
    <>
      {variant === "menu" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.full_name}`}>
              <MoreVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52 rounded-xl p-1.5">
            {showView && (
              <>
                <DropdownMenuItem asChild className={ITEM}>
                  <Link href={`/admin/members/${member.id}`}>
                    <ClockIcon className="text-primary" /> View activity
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem className={ITEM} onSelect={() => setEditOpen(true)}>
              <PencilIcon /> Edit
            </DropdownMenuItem>
            {!isSelf && (
              <>
                <DropdownMenuItem className={ITEM} onSelect={() => setResetOpen(true)}>
                  <KeyRoundIcon className="text-primary" /> Reset password
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={cn(
                    ITEM,
                    is_active
                      ? "text-amber-600 focus:text-amber-600 dark:text-amber-400 dark:focus:text-amber-400 [&_svg]:!text-current"
                      : "text-success focus:text-success [&_svg]:!text-current",
                  )}
                  onSelect={() => setConfirmOpen(true)}
                >
                  {is_active ? <UserXIcon /> : <UserCheckIcon />}
                  {is_active ? "Deactivate" : "Activate"}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <PencilIcon /> Edit
          </Button>
          {!isSelf && (
            <>
              <Button variant="outline" onClick={() => setResetOpen(true)}>
                <KeyRoundIcon /> Reset password
              </Button>
              <Button
                variant={is_active ? "outline" : "success"}
                className={is_active ? "text-amber-600 hover:text-amber-600 dark:text-amber-400" : undefined}
                onClick={() => setConfirmOpen(true)}
                disabled={pending}
              >
                {is_active ? <UserXIcon /> : <UserCheckIcon />}
                {is_active ? "Deactivate" : "Activate"}
              </Button>
            </>
          )}
        </div>
      )}

      <EditMemberDialog
        member={editable}
        roleOptions={roleOptions}
        open={editOpen}
        onOpenChange={setEditOpen}
        access={access}
      />

      {!isSelf && (
        <ResetPasswordDialog
          member={{ id: member.id, full_name: member.full_name }}
          open={resetOpen}
          onOpenChange={setResetOpen}
          canReset={canManageAuth}
        />
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {is_active ? `Deactivate ${member.full_name}?` : `Activate ${member.full_name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {is_active
                ? "They will be signed out and can't log in or submit work. Their history is kept, and you can activate them again any time."
                : "They will be able to log in and submit work again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={is_active ? "bg-amber-600 text-white hover:bg-amber-600/90" : "bg-success text-white hover:bg-success/90"}
              onClick={toggleActive}
            >
              {is_active ? "Deactivate" : "Activate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
