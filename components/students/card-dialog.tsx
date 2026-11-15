"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { setConcessionCardAction } from "@/lib/actions/students";
import { CARD_LABEL, CARD_TYPES, STATUS_LABEL, STATUSES } from "@/lib/students/rules";
import type { ConcessionCard, ConcessionStatus } from "@/lib/supabase/database.types";

/**
 * Change the card type and / or status. Every change except plain verifying
 * needs a reason; it is kept in the student's history and the activity log.
 */
export function CardDialog({
  student,
  initialStatus,
  children,
}: {
  student: { id: string; card: ConcessionCard; status: ConcessionStatus; updatedAt: string; missing: string[] };
  /** Open with this status chosen (e.g. the Verify button). */
  initialStatus?: ConcessionStatus;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState(student.card);
  const [status, setStatus] = useState(initialStatus ?? student.status);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const plainVerify = status === "verified" && student.status !== "verified" && card === student.card;
  const unchanged = card === student.card && status === student.status;
  const blocked = status === "verified" && student.missing.length > 0 && card === student.card;

  const onOpenChange = (next: boolean) => {
    if (next) {
      setCard(student.card);
      setStatus(initialStatus ?? student.status);
      setNote("");
    }
    setOpen(next);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await setConcessionCardAction({
        id: student.id,
        card_type: card,
        status,
        note,
        expected_updated_at: student.updatedAt,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Card and status</DialogTitle>
          <DialogDescription>Each change is kept in the student&apos;s history and the activity log.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="card-type">Card type</Label>
              <Select value={card} onValueChange={(v) => setCard(v as ConcessionCard)}>
                <SelectTrigger id="card-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARD_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CARD_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="card-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ConcessionStatus)}>
                <SelectTrigger id="card-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {blocked && (
            <p className="bg-warning/15 rounded-lg p-3 text-sm">
              Before verifying, add: <span className="font-medium">{student.missing.join(", ")}</span>.
            </p>
          )}
          {!plainVerify && (
            <div className="grid gap-2">
              <Label htmlFor="card-note">Reason</Label>
              <Textarea
                id="card-note"
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={status === "ended" ? "e.g. Left the class in October" : "e.g. Father found work, moved to a Half card"}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pending={pending} disabled={unchanged || blocked || (!plainVerify && note.trim().length < 3)}>
              {plainVerify ? "Verify" : "Save"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
