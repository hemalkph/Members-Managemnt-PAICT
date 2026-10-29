"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FolderPlusIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { toast } from "sonner";

import SpotlightCard from "@/components/reactbits/spotlight-card";
import { EmptyState } from "@/components/empty-state";
import { SubmitButton } from "@/components/submit-button";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { deleteRoleAction, deleteSectionAction, saveRoleAction, saveSectionAction } from "@/lib/actions/admin";
import type { ActionResult } from "@/lib/action-result";
import { roleSchema, sectionSchema, type RoleInput, type SectionInput } from "@/lib/validation";

export type StructureSection = {
  id: string;
  name: string;
  description: string | null;
  roles: { id: string; name: string; description: string | null; members: number; submissions: number }[];
};

type Editing =
  | { kind: "section"; value: SectionInput }
  | { kind: "role"; value: RoleInput }
  | null;

type Deleting = { kind: "section" | "role"; id: string; name: string; note?: string } | null;

export function StructureManager({ sections, readOnly = false }: { sections: StructureSection[]; readOnly?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Deleting>(null);
  const [pending, startTransition] = useTransition();

  const done = (result: ActionResult) => {
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(result.message);
    router.refresh();
    return true;
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const target = deleting;
    startTransition(async () => {
      const result =
        target.kind === "section" ? await deleteSectionAction({ id: target.id }) : await deleteRoleAction({ id: target.id });
      if (done(result)) setDeleting(null);
    });
  };

  return (
    <div className="space-y-4">
      <div className={readOnly ? "hidden" : "flex justify-end"}>
        <Button onClick={() => setEditing({ kind: "section", value: { name: "", description: "" } })}>
          <FolderPlusIcon /> Add section
        </Button>
      </div>

      {sections.length === 0 ? (
        <EmptyState icon={FolderPlusIcon} title="No sections yet" description="Add a section, then add roles (teams) inside it." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sections.map((section) => (
            <SpotlightCard key={section.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2 border-b p-4">
                <div className="min-w-0">
                  <h3 className="font-semibold">{section.name}</h3>
                  {section.description && <p className="text-muted-foreground text-sm">{section.description}</p>}
                </div>
                {!readOnly && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${section.name}`}>
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() =>
                        setEditing({ kind: "role", value: { section_id: section.id, name: "", description: "" } })
                      }
                    >
                      <PlusIcon /> Add role
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setEditing({
                          kind: "section",
                          value: { id: section.id, name: section.name, description: section.description ?? "" },
                        })
                      }
                    >
                      <PencilIcon /> Rename section
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() =>
                        setDeleting({
                          kind: "section",
                          id: section.id,
                          name: section.name,
                          note: `Its ${section.roles.length} role(s) and their member assignments will also be removed.`,
                        })
                      }
                    >
                      <Trash2Icon /> Delete section
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                )}
              </div>
              <ul className="flex-1 divide-y">
                {section.roles.length === 0 && <li className="text-muted-foreground p-4 text-sm">No roles yet.</li>}
                {section.roles.map((role) => (
                  <li key={role.id} className="flex items-center gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{role.name}</p>
                      {role.description && <p className="text-muted-foreground truncate text-xs">{role.description}</p>}
                    </div>
                    <Badge variant="secondary" title="Members with this role">
                      <UsersIcon /> {role.members}
                    </Badge>
                    {!readOnly && (
                    <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Rename ${role.name}`}
                      onClick={() =>
                        setEditing({
                          kind: "role",
                          value: { id: role.id, section_id: section.id, name: role.name, description: role.description ?? "" },
                        })
                      }
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Delete ${role.name}`}
                      onClick={() =>
                        setDeleting({
                          kind: "role",
                          id: role.id,
                          name: role.name,
                          note:
                            role.submissions > 0
                              ? `This role has ${role.submissions} logged submission(s), so it can't be deleted. Rename it instead.`
                              : role.members > 0
                                ? `${role.members} member(s) will lose this role.`
                                : undefined,
                        })
                      }
                    >
                      <Trash2Icon />
                    </Button>
                    </>
                    )}
                  </li>
                ))}
              </ul>
              <div className={readOnly ? "hidden" : "border-t p-2"}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setEditing({ kind: "role", value: { section_id: section.id, name: "", description: "" } })}
                >
                  <PlusIcon /> Add role
                </Button>
              </div>
            </SpotlightCard>
          ))}
        </div>
      )}

      {editing?.kind === "section" && (
        <SectionDialog
          value={editing.value}
          onClose={() => setEditing(null)}
          onSave={async (v) => done(await saveSectionAction(v))}
        />
      )}
      {editing?.kind === "role" && (
        <RoleDialog
          value={editing.value}
          sections={sections}
          onClose={() => setEditing(null)}
          onSave={async (v) => done(await saveRoleAction(v))}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.note ?? "This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SectionDialog({
  value,
  onClose,
  onSave,
}: {
  value: SectionInput;
  onClose: () => void;
  onSave: (v: SectionInput) => Promise<boolean>;
}) {
  const [pending, startTransition] = useTransition();
  const form = useForm<SectionInput>({ resolver: zodResolver(sectionSchema), defaultValues: value });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{value.id ? "Rename section" : "Add section"}</DialogTitle>
          <DialogDescription>Sections group related roles, e.g. “Paper Panel”.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={form.handleSubmit((v) => startTransition(async () => void ((await onSave(v)) && onClose())))}
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
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

function RoleDialog({
  value,
  sections,
  onClose,
  onSave,
}: {
  value: RoleInput;
  sections: StructureSection[];
  onClose: () => void;
  onSave: (v: RoleInput) => Promise<boolean>;
}) {
  const [pending, startTransition] = useTransition();
  const form = useForm<RoleInput>({ resolver: zodResolver(roleSchema), defaultValues: value });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{value.id ? "Edit role" : "Add role"}</DialogTitle>
          <DialogDescription>Roles are the teams members belong to, e.g. “Graphic Design”.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={form.handleSubmit((v) => startTransition(async () => void ((await onSave(v)) && onClose())))}
          >
            <FormField
              control={form.control}
              name="section_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
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
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role name</FormLabel>
                  <FormControl>
                    <Input autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
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
