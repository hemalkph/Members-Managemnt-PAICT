import Link from "next/link";
import { CalendarIcon, FileIcon, HashIcon, Link2Icon, MessageSquareIcon, PencilIcon } from "lucide-react";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SubmissionStatus } from "@/lib/database.types";
import { formatBytes, formatDate } from "@/lib/format";
import { DeleteSubmissionButton } from "./delete-submission-button";

export type MemberSubmission = {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  date_done: string;
  links: string[];
  status: SubmissionStatus;
  admin_comment: string | null;
  roles: { name: string; sections: { name: string } | null } | null;
  submission_attachments: { id: string; file_name: string; size_bytes: number }[];
};

export function SubmissionCard({ submission, editable = true }: { submission: MemberSubmission; editable?: boolean }) {
  const s = submission;
  const canEdit = editable && s.status === "pending";

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
        <StatusBadge status={s.status} />
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1">
          <HashIcon className="size-3.5" /> Qty {s.quantity}
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarIcon className="size-3.5" /> {formatDate(s.date_done)}
        </span>
      </div>

      {s.description && <p className="text-sm whitespace-pre-line">{s.description}</p>}

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

      {s.admin_comment && (
        <div className="bg-muted/60 flex gap-2 rounded-lg p-3 text-sm">
          <MessageSquareIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div>
            <p className="text-muted-foreground text-xs font-medium">Admin comment</p>
            <p className="whitespace-pre-line">{s.admin_comment}</p>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="flex justify-end gap-1 border-t pt-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/work/${s.id}/edit`}>
              <PencilIcon /> Edit
            </Link>
          </Button>
          <DeleteSubmissionButton id={s.id} title={s.title} />
        </div>
      )}
    </SpotlightCard>
  );
}
