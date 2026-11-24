"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { deleteClassAction, saveClassAction } from "@/lib/actions/class-ops";
import type { ClassMode } from "@/lib/supabase/database.types";

export type ClassItem = { id: string; batchId: string; name: string; mode: ClassMode; isActive: boolean };

export const MODE_LABEL: Record<ClassMode, string> = { physical: "Physical", online: "Online", both: "Physical + Online" };

const MODE_HINT: Record<ClassMode, string> = {
  physical: "Everyone comes to the hall; no Speed Post.",
  online: "Everyone gets tutes by Speed Post.",
  both: "Split by the paid list's Institute column (\u201cOnline\u201d goes by Speed Post).",
};

export function ClassDialog({
  batches,
  defaultBatchId,
  editing,
  onSaved,
  children,
}: {
  batches: { id: string; name: string; isActive: boolean }[];
  defaultBatchId: string;
  editing?: ClassItem;
  onSaved?: (classId: string, batchId: string) => void;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [batchId, setBatchId] = useState(editing?.batchId ?? defaultBatchId);
  const [name, setName] = useState(editing?.name ?? "");
  const [mode, setMode] = useState<ClassMode>(editing?.mode ?? "both");
  const [active, setActive] = useState(editing?.isActive ?? true);
  const [pending, startTransition] = useTransition();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setBatchId(editing?.batchId ?? defaultBatchId);
      setName(editing?.name ?? "");
      setMode(editing?.mode ?? "both");
      setActive(editing?.isActive ?? true);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveClassAction({
        id: editing?.id,
        batch_id: batchId,
        name: name.trim(),
        is_active: active,
        mode,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setOpen(false);
      if (res.data?.id && onSaved) onSaved(res.data.id, batchId);
      else router.refresh();
    });
  };

  const remove = () => {
    if (!editing) return;
    startTransition(async () => {
      const res = await deleteClassAction(editing.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm">
            <PlusIcon /> Add class
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit class" : "Add class"}</DialogTitle>
          <DialogDescription>
            A batch can have many classes. Fee reminders, Tute stock and Speed Post all use these classes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="class-batch">Batch</Label>
            <Select value={batchId} onValueChange={setBatchId}>
              <SelectTrigger id="class-batch">
                <SelectValue placeholder="Choose a batch" />
              </SelectTrigger>
              <SelectContent>
                {batches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                    {!b.isActive ? " (inactive)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="class-name">Class name</Label>
            <Input
              id="class-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 2027 Grand Revision, 2027 Theory"
              maxLength={120}
              required
            />
            <p className="text-muted-foreground text-xs">
              Use the base class name without the month (e.g. &ldquo;2027 Grand Revision&rdquo;).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="class-mode">Students</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as ClassMode)}>
              <SelectTrigger id="class-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MODE_LABEL) as ClassMode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {MODE_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{MODE_HINT[mode]}</p>
          </div>
          {editing && (
            <div className="flex items-center gap-2">
              <Switch id="class-active" checked={active} onCheckedChange={setActive} />
              <Label htmlFor="class-active">In use (untick to archive)</Label>
            </div>
          )}

          <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
            {editing ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" size="sm" disabled={pending}>
                    <Trash2Icon /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete &ldquo;{editing.name}&rdquo;?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes all uploaded monthly paid lists, typed paid counts, follow-up records,
                      and monthly tute schedules for this class. If the class has past history, untick &ldquo;In
                      use&rdquo; to archive it instead.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete class
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !batchId || name.trim().length < 2}>
                {pending && <Loader2Icon className="animate-spin" />}
                {editing ? "Save changes" : "Add class"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
