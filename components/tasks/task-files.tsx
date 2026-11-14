"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { DownloadIcon, FileIcon, Loader2Icon, PaperclipIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { safeFileName } from "@/components/papers/paper-files";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/core/action-result";
import { addTaskFilesAction, deleteTaskFileAction } from "@/lib/actions/tasks";
import { formatBytes } from "@/lib/core/format";
import { createClient } from "@/lib/supabase/client";
import type { TaskFileView, TaskView } from "@/lib/tasks/queries";
import { MAX_TASK_FILE_BYTES, MAX_TASK_FILES_AT_ONCE, TASKS_BUCKET } from "@/lib/core/validation";

/** Upload files to storage, then save them on the task. All or nothing. */
export async function uploadTaskFiles(
  taskId: string,
  kind: "brief" | "work",
  files: File[],
): Promise<ActionResult<{ ids: string[] }>> {
  if (files.length > MAX_TASK_FILES_AT_ONCE) return { ok: false, error: `Up to ${MAX_TASK_FILES_AT_ONCE} files at a time.` };
  const tooBig = files.find((f) => f.size > MAX_TASK_FILE_BYTES);
  if (tooBig) return { ok: false, error: `${tooBig.name} is over 50 MB. Share a link to it in the details instead.` };

  const storage = createClient().storage.from(TASKS_BUCKET);
  const done: { storage_path: string; file_name: string; mime_type: string | null; size_bytes: number }[] = [];
  for (const [i, file] of files.entries()) {
    const path = `${taskId}/${kind}/${Date.now()}-${i}-${safeFileName(file.name)}`;
    const { error } = await storage.upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) {
      if (done.length) await storage.remove(done.map((d) => d.storage_path));
      return {
        ok: false,
        error: /security|policy|unauthori[sz]ed|403/i.test(error.message)
          ? "You can't add files to this task."
          : `Could not upload ${file.name}. Please try again.`,
      };
    }
    done.push({ storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type || null, size_bytes: file.size });
  }
  return addTaskFilesAction({ task_id: taskId, kind, files: done });
}

/** Chosen files waiting to be uploaded, with a remove button each. */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="grid gap-1.5">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
          <FileIcon className="text-muted-foreground size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="text-muted-foreground text-xs">{formatBytes(f.size)}</span>
          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)}>
            <XIcon />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The task's files: the brief from the admins and the member's work. A file is
 * "New" until the other side opens it.
 */
export function TaskFilesButton({
  task,
  mode,
  readOnly = false,
}: {
  task: TaskView;
  mode: "member" | "admin";
  readOnly?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const active = task.status === "open" || task.status === "done";
  const uploadKind = mode === "admin" ? (readOnly ? null : "brief") : active ? "work" : null;
  // What this viewer waits for from the other side.
  const incoming = mode === "member" ? "brief" : "work";
  const isNew = (f: TaskFileView) => f.kind === incoming && !f.seen && !opened.has(f.id);
  const newCount = task.files.filter(isNew).length;
  const canDelete = (f: TaskFileView) => (mode === "admin" ? !readOnly : f.kind === "work" && active);

  if (task.paperId || (task.files.length === 0 && !uploadKind)) return null;

  const first = task.assigneeName.split(" ")[0];
  const sections = [
    { kind: "brief" as const, title: mode === "member" ? "From the admin" : `Files for ${first}`, empty: "No files yet." },
    {
      kind: "work" as const,
      title: mode === "member" ? "Your work" : `${first}'s work`,
      empty: mode === "member" ? "Add your finished files here." : "Nothing uploaded yet.",
    },
  ];

  const upload = async (list: FileList | null) => {
    if (!list?.length || !uploadKind) return;
    setBusy(true);
    const result = await uploadTaskFiles(task.id, uploadKind, Array.from(list));
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message);
    startTransition(() => router.refresh());
  };

  const remove = (id: string) =>
    startTransition(async () => {
      const result = await deleteTaskFileAction({ id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  return (
    <>
      <Button type="button" size="sm" variant="outline" className="w-full justify-start" onClick={() => setOpen(true)}>
        <PaperclipIcon />
        {task.files.length === 0 ? "Add files" : `Files (${task.files.length})`}
        {newCount > 0 && (
          <Badge variant="warning" className="ml-auto h-5">
            {newCount} new
          </Badge>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="pr-6">{task.title}</DialogTitle>
            <DialogDescription>
              {mode === "member"
                ? "Files for this task, and the work you hand in. Up to 50 MB each."
                : "Files you gave the member, and the work they hand in. Up to 50 MB each."}
            </DialogDescription>
          </DialogHeader>

          {sections.map((s) => {
            const files = task.files.filter((f) => f.kind === s.kind);
            return (
              <section key={s.kind} className="space-y-2">
                <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{s.title}</h3>
                {files.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{s.empty}</p>
                ) : (
                  <ul className="space-y-2">
                    {files.map((f) => (
                      <li key={f.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                        <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                          <FileIcon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <a
                              href={`/tasks/files/${f.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="min-w-0 truncate text-sm font-medium hover:underline"
                              onClick={() => setOpened((o) => new Set(o).add(f.id))}
                            >
                              {f.fileName}
                            </a>
                            {isNew(f) && (
                              <Badge variant="warning" className="h-5 shrink-0">
                                New
                              </Badge>
                            )}
                          </div>
                          <p className="text-muted-foreground truncate text-xs">
                            {formatBytes(f.sizeBytes)} · {f.when}
                          </p>
                        </div>
                        <Button asChild variant="ghost" size="icon" aria-label={`Download ${f.fileName}`}>
                          <a href={`/tasks/files/${f.id}?download=1`} onClick={() => setOpened((o) => new Set(o).add(f.id))}>
                            <DownloadIcon />
                          </a>
                        </Button>
                        {canDelete(f) && (
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
                {uploadKind === s.kind && (
                  <Button type="button" variant="outline" className="w-full border-dashed" disabled={busy} onClick={() => inputRef.current?.click()}>
                    {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
                    {busy ? "Uploading…" : "Add files"}
                  </Button>
                )}
              </section>
            );
          })}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            aria-label="Choose files"
            onChange={(e) => void upload(e.target.files)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
