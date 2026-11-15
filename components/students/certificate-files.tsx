"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { DownloadIcon, FileIcon, Loader2Icon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { safeFileName } from "@/components/papers/paper-files";
import { Button } from "@/components/ui/button";
import { addConcessionFilesAction, deleteConcessionFileAction } from "@/lib/actions/students";
import { formatBytes, formatDate } from "@/lib/core/format";
import {
  CONCESSION_BUCKET,
  CONCESSION_FILE_TYPES,
  MAX_CONCESSION_FILE_BYTES,
  MAX_CONCESSION_FILES_AT_ONCE,
} from "@/lib/core/validation";
import { createClient } from "@/lib/supabase/client";
import type { StudentDetail } from "@/lib/students/queries";

/** GN certificate scans. Opening one is logged; links last 60 seconds. */
export function CertificateFiles({
  studentId,
  files,
  canEdit,
}: {
  studentId: string;
  files: StudentDetail["files"];
  canEdit: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  const upload = async (list: FileList | null) => {
    const chosen = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (chosen.length === 0) return;
    if (chosen.length > MAX_CONCESSION_FILES_AT_ONCE) return toast.error(`Up to ${MAX_CONCESSION_FILES_AT_ONCE} files at a time.`);
    const bad = chosen.find((f) => !CONCESSION_FILE_TYPES.includes(f.type));
    if (bad) return toast.error(`${bad.name}: use a photo (JPG, PNG, HEIC) or a PDF.`);
    const big = chosen.find((f) => f.size > MAX_CONCESSION_FILE_BYTES);
    if (big) return toast.error(`${big.name} is over 10 MB.`);

    setBusy(true);
    const storage = createClient().storage.from(CONCESSION_BUCKET);
    const done: { storage_path: string; file_name: string; mime_type: string | null; size_bytes: number }[] = [];
    for (const [i, file] of chosen.entries()) {
      const path = `${studentId}/${Date.now()}-${i}-${safeFileName(file.name)}`;
      const { error } = await storage.upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        if (done.length) await storage.remove(done.map((d) => d.storage_path));
        setBusy(false);
        return toast.error(`Could not upload ${file.name}. Please try again.`);
      }
      done.push({ storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size });
    }
    const result = await addConcessionFilesAction({ student_id: studentId, files: done });
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    toast.success(result.message);
    router.refresh();
  };

  const remove = (id: string) =>
    startTransition(async () => {
      const result = await deleteConcessionFileAction({ id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {files.length === 0 ? (
        <p className="text-muted-foreground text-sm">No GN certificate uploaded yet.</p>
      ) : (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-lg border p-2.5">
              <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <FileIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <a
                  href={`/admin/students/files/${f.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {f.fileName}
                </a>
                <p className="text-muted-foreground truncate text-xs">
                  {formatBytes(f.sizeBytes)} · {formatDate(f.createdAt)}
                  {f.uploadedBy && ` · ${f.uploadedBy}`}
                </p>
              </div>
              <Button asChild variant="ghost" size="icon" aria-label={`Download ${f.fileName}`}>
                <a href={`/admin/students/files/${f.id}?download=1`}>
                  <DownloadIcon />
                </a>
              </Button>
              {canEdit && (
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
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            {busy ? "Uploading…" : "Upload certificate"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={CONCESSION_FILE_TYPES.join(",")}
            className="hidden"
            aria-label="Choose certificate files"
            onChange={(e) => void upload(e.target.files)}
          />
        </>
      )}
      <p className="text-muted-foreground text-xs">Photo or PDF, up to 10 MB. Each time someone opens a certificate it is logged.</p>
    </div>
  );
}
