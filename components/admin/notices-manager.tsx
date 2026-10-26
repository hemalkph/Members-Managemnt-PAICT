"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MegaphoneIcon, PencilIcon, PinIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

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
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { deleteAnnouncementAction, saveAnnouncementAction } from "@/lib/actions/announcements";
import { formatDate } from "@/lib/format";
import { announcementSchema, type AnnouncementInput } from "@/lib/validation";

export type ManagedNotice = {
  id: string;
  title: string;
  body: string | null;
  pinned: boolean;
  expires_on: string | null;
  created_at: string;
  author: string | null;
  expired: boolean;
};

const EMPTY: AnnouncementInput = { title: "", body: "", pinned: false, expires_on: "" };

export function NoticesManager({ notices }: { notices: ManagedNotice[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AnnouncementInput | null>(null);
  const [deleting, setDeleting] = useState<ManagedNotice | null>(null);
  const [pending, startTransition] = useTransition();

  const onDelete = () => {
    if (!deleting) return;
    const target = deleting;
    startTransition(async () => {
      const result = await deleteAnnouncementAction({ id: target.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setDeleting(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing(EMPTY)}>
          <PlusIcon /> New notice
        </Button>
      </div>

      {notices.length === 0 ? (
        <EmptyState
          icon={MegaphoneIcon}
          title="No notices yet"
          description="Post reminders, deadlines or good news. Members see them on their dashboard."
        />
      ) : (
        <div className="grid gap-3">
          {notices.map((n) => (
            <Card key={n.id} className={n.expired ? "gap-2 px-4 py-4 opacity-60" : "gap-2 px-4 py-4"}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {n.pinned && <PinIcon className="text-primary size-4" aria-label="Pinned" />}
                    {n.title}
                    {n.expired && <Badge variant="outline">Expired</Badge>}
                  </p>
                  {n.body && <p className="text-muted-foreground text-sm whitespace-pre-line">{n.body}</p>}
                  <p className="text-muted-foreground text-xs">
                    {n.author ? `${n.author} · ` : ""}
                    {formatDate(n.created_at)}
                    {n.expires_on ? ` · shown until ${formatDate(n.expires_on)}` : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${n.title}`}
                    onClick={() =>
                      setEditing({
                        id: n.id,
                        title: n.title,
                        body: n.body ?? "",
                        pinned: n.pinned,
                        expires_on: n.expires_on ?? "",
                      })
                    }
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    aria-label={`Delete ${n.title}`}
                    onClick={() => setDeleting(n)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && <NoticeDialog value={editing} onClose={() => setEditing(null)} />}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this notice?</AlertDialogTitle>
            <AlertDialogDescription>&ldquo;{deleting?.title}&rdquo; will disappear for everyone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                onDelete();
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

function NoticeDialog({ value, onClose }: { value: AnnouncementInput; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<AnnouncementInput>({ resolver: zodResolver(announcementSchema), defaultValues: value });

  const onSubmit = (values: AnnouncementInput) =>
    startTransition(async () => {
      const result = await saveAnnouncementAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{value.id ? "Edit notice" : "New notice"}</DialogTitle>
          <DialogDescription>Shown on every member&apos;s dashboard.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Term test marking due Friday" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={4} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="expires_on"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Show until (optional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormDescription>Leave empty to keep it until you delete it.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="pinned"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Pin to the top</FormLabel>
                    <FormDescription>Pinned notices always show first.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>{value.id ? "Save" : "Post notice"}</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
