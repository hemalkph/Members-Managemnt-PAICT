import Link from "next/link";
import {
  CalendarIcon,
  CopyPlusIcon,
  FileIcon,
  HashIcon,
  Link2Icon,
  MessageSquareIcon,
  PencilIcon,
  RotateCcwIcon,
  TagIcon,
  WrenchIcon,
  GraduationCapIcon,
  MapPinIcon,
  WalletIcon,
} from "lucide-react";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SubmissionStatus } from "@/lib/supabase/database.types";
import { formatBytes, formatDate, formatLKR } from "@/lib/core/format";
import { cn } from "@/lib/utils";
import { DeleteSubmissionButton } from "./delete-submission-button";
import { DriveVideoList, type SavedVideo } from "./drive-video-list";

export type MemberSubmission = {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  date_done: string;
  links: string[];
  status: SubmissionStatus;
  admin_comment: string | null;
  resubmitted_at?: string | null;
  unit_price: number | null;
  amount: number | null;
  rate_items: { name: string; unit: string } | null;
  exam?: { name: string } | null;
  centre?: { name: string } | null;
  roles: { name: string; sections: { name: string } | null } | null;
  submission_attachments: { id: string; file_name: string; size_bytes: number }[];
  submission_videos: SavedVideo[];
};

export function SubmissionCard({
  submission,
  editable = true,
  showMoney = false,
}: {
  submission: MemberSubmission;
  editable?: boolean;
  /** Show the amount (quantity × rate) for this work. */
  showMoney?: boolean;
}) {
  const s = submission;
  const canEdit = editable && s.status === "pending";
  const rejected = s.status === "rejected";
  const resent = s.status === "pending" && Boolean(s.resubmitted_at);

  return (
    <SpotlightCard className="grid gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 className="leading-snug font-medium break-words">{s.title}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {s.roles && (
              <Badge variant="outline">
                {s.roles.sections?.name ? `${s.roles.sections.name} · ` : ""}
                {s.roles.name}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {resent && (
            <Badge variant="outline">
              <RotateCcwIcon /> Sent again
            </Badge>
          )}
          <StatusBadge status={s.status} />
        </div>
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1">
          <HashIcon className="size-3.5" /> Qty {s.quantity}
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarIcon className="size-3.5" /> {formatDate(s.date_done)}
        </span>
        {s.rate_items && (
          <span className="inline-flex items-center gap-1">
            <TagIcon className="size-3.5" /> {s.rate_items.name}
          </span>
        )}
        {s.exam && (
          <span className="inline-flex items-center gap-1">
            <GraduationCapIcon className="size-3.5" /> {s.exam.name}
          </span>
        )}
        {s.centre && (
          <span className="inline-flex items-center gap-1">
            <MapPinIcon className="size-3.5" /> {s.centre.name}
          </span>
        )}
        {showMoney && s.amount !== null && s.status !== "rejected" && (
          <span className="text-foreground inline-flex items-center gap-1 font-medium">
            <WalletIcon className="size-3.5" /> {formatLKR(Number(s.amount))}
            {s.status === "pending" && <span className="text-muted-foreground font-normal">(estimate)</span>}
          </span>
        )}
      </div>

      {s.description && <p className="text-sm whitespace-pre-line">{s.description}</p>}

      <DriveVideoList videos={s.submission_videos} />

      {(s.links.length > 0 || s.submission_attachments.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {s.links.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex max-w-full items-center gap-1 truncate rounded-md border px-2 py-1 text-xs hover:underline"
            >
              <Link2Icon className="size-3.5 shrink-0" />
              <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
            </a>
          ))}
          {s.submission_attachments.map((a) => (
            <a
              key={a.id}
              href={`/files/${a.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs hover:underline"
            >
              <FileIcon className="size-3.5 shrink-0" />
              <span className="truncate">{a.file_name}</span>
              <span className="text-muted-foreground">({formatBytes(a.size_bytes)})</span>
            </a>
          ))}
        </div>
      )}

      {(s.admin_comment || rejected) && (
        <div
          className={cn(
            "flex gap-2 rounded-lg p-3 text-sm",
            rejected ? "border-destructive/40 bg-destructive/5 border" : "bg-muted/60",
          )}
        >
          <MessageSquareIcon className={cn("mt-0.5 size-4 shrink-0", rejected ? "text-destructive" : "text-muted-foreground")} />
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs font-medium">
              {rejected ? "Why it was not approved" : resent ? "Earlier reason it was not approved" : "Admin comment"}
            </p>
            <p className="break-words whitespace-pre-line">{s.admin_comment || "No reason given."}</p>
            {rejected && editable && (
              <Button asChild size="sm" className="mt-3 w-full sm:w-auto">
                <Link href={`/work/${s.id}/edit`}>
                  <WrenchIcon /> Fix and send again
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap justify-end gap-1 border-t pt-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/work/new?from=${s.id}`} title="Start a new submission with the same details">
              <CopyPlusIcon /> Log again
            </Link>
          </Button>
          {canEdit && (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/work/${s.id}/edit`}>
                  <PencilIcon /> Edit
                </Link>
              </Button>
              <DeleteSubmissionButton id={s.id} title={s.title} />
            </>
          )}
        </div>
      )}
    </SpotlightCard>
  );
}
