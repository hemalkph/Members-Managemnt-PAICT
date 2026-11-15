"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckIcon, FlagIcon } from "lucide-react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { raiseFlagAction, resolveFlagAction } from "@/lib/actions/students";
import { formatDate } from "@/lib/core/format";
import { MANUAL_FLAG_LABEL, type FlagView, type ManualFlagKind } from "@/lib/students/flags";

const KIND_BADGE: Record<ManualFlagKind, "destructive" | "warning" | "success"> = {
  needs_review: "destructive",
  warning: "warning",
  top: "success",
};

export function ManualFlagBadge({ kind }: { kind: ManualFlagKind }) {
  return (
    <Badge variant={KIND_BADGE[kind]}>
      <FlagIcon /> {MANUAL_FLAG_LABEL[kind]}
    </Badge>
  );
}

/** Flags an admin raised on this student, with the reason; open ones first. */
export function ManualFlags({ studentId, flags, canEdit }: { studentId: string; flags: FlagView[]; canEdit: boolean }) {
  const router = useRouter();
  const [raising, setRaising] = useState(false);
  const [kind, setKind] = useState<ManualFlagKind>("needs_review");
  const [reason, setReason] = useState("");
  const [resolving, setResolving] = useState<FlagView | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const done = (ok: boolean, message?: string, error?: string) => {
    if (!ok) {
      toast.error(error);
      return false;
    }
    toast.success(message);
    router.refresh();
    return true;
  };

  const raise = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const r = await raiseFlagAction({ student_id: studentId, kind, reason });
      if (done(r.ok, r.ok ? r.message : undefined, r.ok ? undefined : r.error)) {
        setRaising(false);
        setReason("");
      }
    });
  };
  const resolve = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolving) return;
    startTransition(async () => {
      const r = await resolveFlagAction({ id: resolving.id, student_id: studentId, note });
      if (done(r.ok, r.ok ? r.message : undefined, r.ok ? undefined : r.error)) {
        setResolving(null);
        setNote("");
      }
    });
  };

  const open = flags.filter((f) => !f.resolvedAt);
  const closed = flags.filter((f) => f.resolvedAt).slice(0, 5);

  return (
    <div className="space-y-3">
      {open.length === 0 && closed.length === 0 && <p className="text-muted-foreground text-sm">No flags.</p>}
      {[...open, ...closed].map((f) => (
        <div key={f.id} className={f.resolvedAt ? "text-muted-foreground space-y-1 text-sm" : "space-y-1 text-sm"}>
          <div className="flex flex-wrap items-center gap-2">
            <ManualFlagBadge kind={f.kind} />
            {f.resolvedAt && <Badge variant="outline">Resolved</Badge>}
            <span className="text-muted-foreground text-xs">
              {formatDate(f.raisedAt)}
              {f.raisedBy && ` · ${f.raisedBy}`}
            </span>
            {canEdit && !f.resolvedAt && (
              <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setResolving(f)}>
                <CheckIcon /> Resolve
              </Button>
            )}
          </div>
          <p className="break-words">{f.reason}</p>
          {f.resolvedAt && (
            <p className="text-xs">
              Resolved {formatDate(f.resolvedAt)}
              {f.resolvedBy && ` by ${f.resolvedBy}`}
              {f.resolveNote && `: ${f.resolveNote}`}
            </p>
          )}
        </div>
      ))}
      {canEdit && (
        <Button variant="outline" size="sm" onClick={() => setRaising(true)}>
          <FlagIcon /> Add a flag
        </Button>
      )}

      <Dialog open={raising} onOpenChange={setRaising}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={raise} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Flag this student</DialogTitle>
              <DialogDescription>Only admins with this page see flags. They stay until someone resolves them.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="flag-kind">Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ManualFlagKind)}>
                <SelectTrigger id="flag-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MANUAL_FLAG_LABEL) as ManualFlagKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {MANUAL_FLAG_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="flag-reason">Reason</Label>
              <Textarea id="flag-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRaising(false)}>
                Cancel
              </Button>
              <SubmitButton pending={pending} disabled={reason.trim().length < 3}>
                Add flag
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={resolving !== null} onOpenChange={(o) => !o && setResolving(null)}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={resolve} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Resolve flag</DialogTitle>
              <DialogDescription>{resolving?.reason}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="flag-note">What was done (optional)</Label>
              <Input id="flag-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResolving(null)}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>Resolve</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
