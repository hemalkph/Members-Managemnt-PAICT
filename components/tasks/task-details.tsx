"use client";

import { CheckIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, FileIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/core/format";
import type { TaskDetail } from "@/lib/tasks/types";

/**
 * A task type's filled-in fields, each with a Copy button (handy when pasting
 * into the LMS). File fields link to the task's file.
 */
export function TaskDetails({
  details,
  files = [],
}: {
  details: TaskDetail[];
  files?: { id: string; fileName: string }[];
}) {
  if (details.length === 0) return null;
  return (
    <dl className="bg-muted/40 grid gap-2 rounded-lg border p-3 text-sm">
      {details.map((d) => (
        <div key={d.id || d.label} className="grid min-w-0 gap-0.5">
          <dt className="text-muted-foreground text-xs">{d.label}</dt>
          <dd className="flex min-w-0 items-start gap-1">
            {d.kind === "file" ? (
              <>
                <a
                  href={`/tasks/files/${d.value}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary inline-flex min-w-0 flex-1 items-center gap-1 hover:underline"
                >
                  <FileIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{files.find((f) => f.id === d.value)?.fileName ?? "Open file"}</span>
                </a>
                <Button asChild variant="ghost" size="icon-sm" className="-my-1 shrink-0">
                  <a href={`/tasks/files/${d.value}?download=1`} aria-label={`Download ${d.label}`}>
                    <DownloadIcon />
                  </a>
                </Button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 break-words whitespace-pre-line">
                  {d.kind === "link" ? (
                    <a
                      href={d.value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex max-w-full items-center gap-1 hover:underline"
                    >
                      <span className="truncate">{d.value.replace(/^https?:\/\//, "")}</span>
                      <ExternalLinkIcon className="size-3.5 shrink-0" />
                    </a>
                  ) : d.kind === "date" ? (
                    formatDate(d.value)
                  ) : (
                    d.value
                  )}
                </span>
                <CopyButton text={d.value} label={d.label} />
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="-my-1 shrink-0"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
    >
      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
    </Button>
  );
}
