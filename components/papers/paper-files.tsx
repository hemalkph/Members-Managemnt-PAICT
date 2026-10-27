"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { DownloadIcon, FileIcon, Loader2Icon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import AnimatedList from "@/components/reactbits/animated-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addPaperFileAction, deletePaperFileAction } from "@/lib/actions/papers";
import type { PaperStageName } from "@/lib/database.types";
import { formatBytes } from "@/lib/format";
import { PAPERS_BUCKET, STAGE_LABEL, STAGES } from "@/lib/papers";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { MAX_PAPER_FILE_BYTES, type UPLOAD_STAGES } from "@/lib/validation";

export type FileItem = {
  id: string;
  stage: PaperStageName;
  version: number;
  fileName: string;
  sizeBytes: number;
  note: string | null;
  uploadedBy: string | null;
  canDelete: boolean;
  /** Pre-formatted on the server. */
  when: string;
  latest: boolean;
};

function safeFileName(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(-100) || "file"
  );
}

/** Upload a new version of a file for a stage. */
export function PaperFileUploader({
  paperId,
  defaultStage,
  stages,
  buttonLabel = "Upload file",
}: {
  paperId: string;
  defaultStage: PaperStageName;
  /** Stages that still take files (only the first four, never from review on). One = no stage menu. */
  stages: { stage: PaperStageName; label: string }[];
  buttonLabel?: string;
}) {
  const single = stages.length === 1;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<PaperStageName>(defaultStage);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_PAPER_FILE_BYTES) {
      toast.error("Files must be 25 MB or smaller.");
      return;
    }
    setBusy(true);
    const path = `${paperId}/${stage}/${Date.now()}-${safeFileName(file.name)}`;
    const { error } = await createClient()
      .storage.from(PAPERS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) {
      setBusy(false);
      toast.error(
        /security|policy|unauthori[sz]ed|403/i.test(error.message)
          ? "Uploads are closed for this stage. Share a link instead, or ask an admin."
          : `Could not upload ${file.name}. Please try again.`,
      );
      return;
    }
    const result = await addPaperFileAction({
      paper_id: paperId,
      stage: stage as (typeof UPLOAD_STAGES)[number],
      storage_path: path,
      file_name: file.name.slice(0, 200),
      mime_type: file.type || null,
      size_bytes: file.size,
      note,
    });
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message);
    setNote("");
    startTransition(() => router.refresh());
  };

  return (
    <div
      className={cn(
        "bg-muted/30 grid gap-3 rounded-xl border border-dashed p-3 sm:items-end",
        single ? "sm:grid-cols-[1fr_auto]" : "sm:grid-cols-[170px_1fr_auto]",
      )}
    >
      {!single && (
        <div className="grid gap-1.5">
          <Label className="text-xs">Stage</Label>
          <Select value={stage} onValueChange={(v) => setStage(v as PaperStageName)}>
            <SelectTrigger aria-label="Stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s.stage} value={s.stage}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`file-note-${stage}`} className="text-xs">
          What changed? (optional)
        </Label>
        <Input
          id={`file-note-${stage}`}
          value={note}
          maxLength={300}
          placeholder="e.g. Fixed Q12 answer"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => void upload(e.target.files?.[0])}
        aria-label="Choose a file"
      />
      <Button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
        {busy ? "Uploading…" : buttonLabel}
      </Button>
    </div>
  );
}

/** Files grouped by stage, newest version first. */
export function PaperFileList({ files }: { files: FileItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const remove = (id: string) =>
    startTransition(async () => {
      const result = await deletePaperFileAction({ id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  if (files.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No files yet. Share drafts here until the English type setting is done.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {STAGES.filter((s) => files.some((f) => f.stage === s.stage)).map((s) => (
        <div key={s.stage} className="space-y-2">
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{STAGE_LABEL[s.stage]}</p>
          <AnimatedList
            items={files
              .filter((f) => f.stage === s.stage)
              .map((f) => ({
                key: f.id,
                node: (
                  <div className="flex items-center gap-3 rounded-lg border p-2.5">
                    <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <FileIcon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Badge variant={f.latest ? "default" : "outline"} className="h-5">
                          v{f.version}
                        </Badge>
                        <a
                          href={`/papers/files/${f.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {f.fileName}
                        </a>
                      </div>
                      <p className="text-muted-foreground truncate text-xs">
                        {formatBytes(f.sizeBytes)} · {f.uploadedBy ?? "Someone"} · {f.when}
                        {f.note && <> · “{f.note}”</>}
                      </p>
                    </div>
                    <Button asChild variant="ghost" size="icon" aria-label={`Download ${f.fileName}`}>
                      <a href={`/papers/files/${f.id}?download=1`}>
                        <DownloadIcon />
                      </a>
                    </Button>
                    {f.canDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                        aria-label={`Remove ${f.fileName}`}
                        disabled={pending}
                        onClick={() => remove(f.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </div>
                ),
              }))}
          />
        </div>
      ))}
    </div>
  );
}
