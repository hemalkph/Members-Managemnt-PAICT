"use client";

import { useState, useTransition } from "react";
import { Loader2Icon, TagIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { setFeeFollowupAction } from "@/lib/actions/fees";
import type { ComparedStudent } from "@/lib/fees/compare";
import { QUICK_LABELS } from "@/lib/fees/templates";
import type { FeeFollowupStatus } from "@/lib/supabase/database.types";

// Outcomes set on the Renewals page: listed only for a row that already has one, so saving keeps it.
const NEW_OUTCOME_LABEL: Partial<Record<FeeFollowupStatus, string>> = {
  promised: "Promised to pay (set on Renewals)",
  cant_afford: "Can't afford (set on Renewals)",
  moved_class: "Moved class (set on Renewals)",
};

export function FollowupDialog({
  student,
  classId,
  dueMonth,
  open,
  onOpenChange,
  onSaved,
}: {
  student: ComparedStudent | null;
  classId: string;
  dueMonth: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (patch: { studentKey: string; status: FeeFollowupStatus; label: string; note: string }) => void;
}) {
  const [status, setStatus] = useState<FeeFollowupStatus>(student?.followupStatus ?? "pending");
  const [label, setLabel] = useState(student?.customLabel ?? student?.exportLabel ?? "");
  const [note, setNote] = useState(student?.note ?? "");
  const [pending, startTransition] = useTransition();

  // Resync form whenever the dialog opens (or closes) or the student's saved state changes.
  const syncToken =
    open && student
      ? `${student.studentKey}|${student.followupStatus}|${student.customLabel}|${student.exportLabel}|${student.note}`
      : null;
  const [lastToken, setLastToken] = useState<string | null>(syncToken);
  if (syncToken !== lastToken) {
    setLastToken(syncToken);
    if (open && student) {
      setStatus(student.followupStatus);
      setLabel(student.customLabel || student.exportLabel || "");
      setNote(student.note);
    }
  }

  if (!student) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await setFeeFollowupAction({
        class_id: classId,
        due_month: dueMonth,
        student_key: student.studentKey,
        student_name: student.fullName,
        email_norm: student.emailNorm,
        whatsapp_norm: student.contactPhoneChanged ? student.previousMessagedPhone : student.contactPhone,
        status,
        label: label.trim(),
        note: note.trim(),
        increment_message: false,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Updated ${student.fullName}`);
      onSaved({ studentKey: student.studentKey, status, label: label.trim(), note: note.trim() });
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TagIcon className="size-4" /> Follow-up &amp; label
          </DialogTitle>
          <DialogDescription>
            {student.fullName} {student.email ? `· ${student.email}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="followup-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as FeeFollowupStatus)}>
              <SelectTrigger id="followup-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Due — Not messaged</SelectItem>
                <SelectItem value="messaged">Messaged</SelectItem>
                <SelectItem value="excused">Excused (e.g. Free card / paying later)</SelectItem>
                <SelectItem value="dropped">Left class / Dropped</SelectItem>
                {student && NEW_OUTCOME_LABEL[student.followupStatus] && (
                  <SelectItem value={student.followupStatus}>{NEW_OUTCOME_LABEL[student.followupStatus]}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="followup-label">Label</Label>
            <Input
              id="followup-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Free card, Half card, Promised Friday"
              maxLength={80}
            />
            <div className="flex flex-wrap gap-1 pt-1">
              {QUICK_LABELS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setLabel(chip);
                    if (chip === "Free card") setStatus("excused");
                    if (chip === "Left class") setStatus("dropped");
                  }}
                  className="bg-muted hover:bg-accent hover:text-accent-foreground rounded-md px-2 py-0.5 text-xs transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="followup-note">Note</Label>
            <Textarea
              id="followup-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note from the call or WhatsApp chat..."
              rows={3}
              maxLength={500}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
