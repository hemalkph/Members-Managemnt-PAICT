"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckIcon, DownloadIcon, FileIcon, Link2Icon, Loader2Icon, RotateCcwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { DriveVideoList, type SavedVideo } from "@/components/member/drive-video-list";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { reviewSubmissionsAction } from "@/lib/actions/admin";
import type { SubmissionStatus } from "@/lib/supabase/database.types";
import { formatBytes, formatDate, formatDateTime, formatLKR } from "@/lib/core/format";
import { monthLabel } from "@/lib/core/month";
import { cn } from "@/lib/utils";

export type ReviewRow = {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  date_done: string;
  links: string[];
  status: SubmissionStatus;
  admin_comment: string | null;
  /** The member fixed rejected work and sent it again (pending rows keep the old reason). */
  resubmittedAt?: string | null;
  reviewed_at: string | null;
  created_at: string;
  /** When the row last changed, as loaded: approving checks it is still the same. */
  updatedAt: string;
  month: string;
  memberName: string;
  memberEmail: string;
  roleName: string;
  sectionName: string;
  reviewerName: string | null;
  workType: string | null;
  examLabel?: string | null;
  centreName?: string | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
  attachments: { id: string; file_name: string; size_bytes: number }[];
  videos: SavedVideo[];
  /** A page count logged from a finished paper stage ("Ready to log"). */
  fromPaper?: boolean;
};

export function ReviewDialog({
  row,
  open,
  onOpenChange,
  readOnly = false,
}: {
  /** Read-only page access: show the work, no decisions. */
  readOnly?: boolean;
  row: ReviewRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const resent = row?.status === "pending" && Boolean(row.resubmittedAt);
  const decided = row?.status === "approved" || row?.status === "rejected";
  // Sent-again work starts with a blank comment; the old reason is shown above it.
  const [comment, setComment] = useState(resent ? "" : (row?.admin_comment ?? ""));
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<SubmissionStatus | null>(null);

  if (!row) return null;

  const decide = (decision: SubmissionStatus) => {
    if (decision === "rejected" && !comment.trim()) {
      toast.error("Please add a comment explaining why it was rejected.");
      return;
    }
    setBusy(decision);
    startTransition(async () => {
      const result = await reviewSubmissionsAction({
        items: [{ id: row.id, seen: row.updatedAt }],
        decision,
        comment: comment.trim(),
      });
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-6">
            <DialogTitle className="leading-snug">{row.title}</DialogTitle>
            {resent && <SentAgainBadge />}
            <StatusBadge status={row.status} />
          </div>
          <DialogDescription>
            {row.memberName} · {row.sectionName} · {row.roleName}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground text-xs">Month</dt>
            <dd>{monthLabel(row.month)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Date done</dt>
            <dd>{formatDate(row.date_done)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Quantity</dt>
            <dd className="font-semibold tabular-nums">{row.quantity}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Submitted</dt>
            <dd>{formatDateTime(row.created_at)}</dd>
          </div>
          {row.workType && (
            <div>
              <dt className="text-muted-foreground text-xs">Type of work</dt>
              <dd>{row.workType}</dd>
            </div>
          )}
          {row.examLabel && (
            <div>
              <dt className="text-muted-foreground text-xs">Exam / test</dt>
              <dd>{row.examLabel}</dd>
            </div>
          )}
          {row.centreName && (
            <div>
              <dt className="text-muted-foreground text-xs">Class centre</dt>
              <dd>{row.centreName}</dd>
            </div>
          )}
          {row.unitPrice !== null && (
            <div>
              <dt className="text-muted-foreground text-xs">Rate</dt>
              <dd>
                {formatLKR(row.unitPrice)} / {row.unit ?? "unit"}
              </dd>
            </div>
          )}
          {row.amount !== null && (
            <div className="col-span-2">
              <dt className="text-muted-foreground text-xs">
                Amount {row.status === "approved" ? "(locked at approval)" : "(estimate)"}
              </dt>
              <dd className="text-base font-semibold">{formatLKR(row.amount)}</dd>
            </div>
          )}
        </dl>

        {row.description && <p className="bg-muted/50 rounded-lg p-3 text-sm whitespace-pre-line">{row.description}</p>}

        {row.videos.length > 0 && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Videos ({row.videos.length})</p>
            <DriveVideoList videos={row.videos} />
          </div>
        )}

        {(row.links.length > 0 || row.attachments.length > 0) && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Attachments & links</p>
            <ul className="divide-y rounded-lg border text-sm">
              {row.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                  <FileIcon className="text-muted-foreground size-4 shrink-0" />
                  <a href={`/files/${a.id}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                    {a.file_name}
                  </a>
                  <span className="text-muted-foreground text-xs">{formatBytes(a.size_bytes)}</span>
                  <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${a.file_name}`}>
                    <a href={`/files/${a.id}?download=1`}>
                      <DownloadIcon />
                    </a>
                  </Button>
                </li>
              ))}
              {row.links.map((url) => (
                <li key={url} className="flex items-center gap-2 px-3 py-2">
                  <Link2Icon className="text-muted-foreground size-4 shrink-0" />
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary min-w-0 flex-1 truncate hover:underline">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {resent && (
          <div className="border-destructive/40 bg-destructive/5 rounded-lg border p-3 text-sm">
            <p className="font-medium">Fixed and sent again {formatDateTime(row.resubmittedAt!)}</p>
            <p className="text-muted-foreground mt-1 text-xs">Earlier reason it was not approved</p>
            <p className="break-words whitespace-pre-line">{row.admin_comment || "No reason was given."}</p>
          </div>
        )}

        <Separator />

        {decided ? (
          // Already decided: show the decision, not the Approve / Reject buttons again.
          <div
            className={cn(
              "flex gap-3 rounded-lg border p-3 text-sm",
              row.status === "approved" ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5",
            )}
          >
            {row.status === "approved" ? (
              <CheckIcon className="text-success mt-0.5 size-4 shrink-0" />
            ) : (
              <XIcon className="text-destructive mt-0.5 size-4 shrink-0" />
            )}
            <div className="min-w-0 space-y-1">
              <p className="font-medium">
                {row.status === "approved" ? "Approved" : "Rejected"}
                {row.reviewed_at && ` ${formatDateTime(row.reviewed_at)}`}
                {row.reviewerName && ` by ${row.reviewerName}`}
              </p>
              {row.admin_comment && (
                <p className="text-muted-foreground break-words whitespace-pre-line">{row.admin_comment}</p>
              )}
              {row.status === "rejected" && (
                <p className="text-muted-foreground text-xs">The member can fix it and send it again.</p>
              )}
            </div>
          </div>
        ) : (
          <div className={readOnly ? "hidden" : "grid gap-2"}>
            <Label htmlFor="review-comment">Comment for the member</Label>
            <Textarea
              id="review-comment"
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional when approving, required when rejecting"
            />
          </div>
        )}

        {decided ? (
          <DialogFooter className={readOnly ? "hidden" : "sm:justify-start"}>
            <Button variant="ghost" onClick={() => decide("pending")} disabled={pending}>
              {busy === "pending" ? <Loader2Icon className="animate-spin" /> : <RotateCcwIcon />} Back to pending to
              change it
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter className={readOnly ? "hidden" : "gap-2 sm:justify-end"}>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => decide("rejected")}
                disabled={pending}
              >
                {busy === "rejected" ? <Loader2Icon className="animate-spin" /> : <XIcon />} Reject
              </Button>
              <Button variant="success" onClick={() => decide("approved")} disabled={pending}>
                {busy === "approved" ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Approve
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Marks rejected work the member fixed and sent again. */
export function SentAgainBadge() {
  return (
    <Badge variant="warning">
      <RotateCcwIcon /> Sent again
    </Badge>
  );
}
