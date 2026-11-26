"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckIcon, Loader2Icon, PaperclipIcon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reviewSubmissionsAction } from "@/lib/actions/admin";
import { formatLKR } from "@/lib/core/format";
import { waitingSince } from "@/lib/review/waiting";
import { SentAgainBadge, type ReviewRow } from "./review-dialog";
import { WaitingChip } from "./waiting-chip";

type Decision = "approved" | "rejected";

/** Phone view of Work review: Approve in one tap, Send back with a comment, Undo for 10 s. */
export function ReviewCards({
  rows,
  readOnly,
  limitHours,
  nowMs,
  onOpen,
}: {
  rows: ReviewRow[];
  readOnly: boolean;
  limitHours: number;
  nowMs: number;
  onOpen: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sendBack, setSendBack] = useState<ReviewRow | null>(null);
  const [comment, setComment] = useState("");

  const undo = (items: { id: string; seen: string }[]) =>
    startTransition(async () => {
      const result = await reviewSubmissionsAction({ items, decision: "pending", comment: "" });
      if (result.ok) toast.success("Undone. It's back in pending.");
      else toast.error(result.error);
      router.refresh();
    });

  const decide = (row: ReviewRow, decision: Decision, text: string) => {
    setBusyId(row.id);
    startTransition(async () => {
      const result = await reviewSubmissionsAction({
        items: [{ id: row.id, seen: row.updatedAt }],
        decision,
        comment: text,
      });
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const items = result.data?.items ?? [];
      toast.success(result.message, {
        duration: 10_000,
        action: items.length > 0 ? { label: "Undo", onClick: () => undo(items) } : undefined,
      });
      setSendBack(null);
      setComment("");
      router.refresh();
    });
  };

  return (
    <div className="grid gap-2 md:hidden">
      {rows.map((r) => {
        const files = r.attachments.length + r.links.length + r.videos.length;
        const busy = busyId === r.id;
        return (
          <Card key={r.id} className="gap-3 p-4">
            <button type="button" className="grid gap-1 text-left" onClick={() => onOpen(r.id)}>
              <span className="leading-snug font-medium break-words">{r.title}</span>
              <span className="text-muted-foreground truncate text-xs">
                {r.memberName} · {r.roleName}
              </span>
              <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-xs">
                <span className="text-foreground font-medium tabular-nums">
                  {r.quantity}
                  {r.unit && ` ${r.unit}${r.quantity === 1 ? "" : "s"}`}
                </span>
                {r.amount !== null && <span className="tabular-nums">{formatLKR(r.amount)}</span>}
                {files > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <PaperclipIcon className="size-3" /> {files}
                  </span>
                )}
              </span>
            </button>
            <div className="flex flex-wrap items-center gap-1">
              <StatusBadge status={r.status} />
              {r.status === "pending" && r.resubmittedAt && <SentAgainBadge />}
              {r.status === "pending" && (
                <WaitingChip
                  since={waitingSince({ created_at: r.created_at, resubmitted_at: r.resubmittedAt })}
                  limitHours={limitHours}
                  nowMs={nowMs}
                />
              )}
            </div>
            {r.status === "pending" && !readOnly && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={pending}
                  onClick={() => {
                    setComment("");
                    setSendBack(r);
                  }}
                >
                  <Undo2Icon /> Send back
                </Button>
                <Button variant="success" disabled={pending} onClick={() => decide(r, "approved", "")}>
                  {busy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Approve
                </Button>
              </div>
            )}
          </Card>
        );
      })}

      <Dialog open={sendBack !== null} onOpenChange={(open) => !open && setSendBack(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send back</DialogTitle>
            <DialogDescription>
              {sendBack?.title} · {sendBack?.memberName}. They&apos;ll see your comment and can fix it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="send-back-comment">What needs fixing</Label>
            <Textarea
              id="send-back-comment"
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending || !comment.trim()}
              onClick={() => sendBack && decide(sendBack, "rejected", comment.trim())}
            >
              {pending ? <Loader2Icon className="animate-spin" /> : <Undo2Icon />} Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
