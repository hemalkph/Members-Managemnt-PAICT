"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  BadgeCheckIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  FileIcon,
  ImageIcon,
  Loader2Icon,
  PencilIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TextTemplates } from "@/components/papers/text-templates";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  addPaperFileAction,
  deletePaperFileAction,
  notifyStageFilesAction,
  setMainPaperFileAction,
  updatePaperFileAction,
} from "@/lib/actions/papers";
import type { PaperFileTag, PaperStageName } from "@/lib/supabase/database.types";
import { formatBytes } from "@/lib/core/format";
import {
  defaultFileTag,
  FILE_TAG_LABEL,
  FILE_TAGS,
  IMAGE_FILE,
  PAPER_TAGS,
  withExtension,
  PAPERS_BUCKET,
  STAGE_LABEL,
  STAGES,
} from "@/lib/papers";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { MAX_PAPER_FILE_BYTES, type UPLOAD_STAGES } from "@/lib/core/validation";

export type FileItem = {
  id: string;
  stage: PaperStageName;
  fileName: string;
  sizeBytes: number;
  /** The uploader's remark, e.g. "images for Q3". */
  note: string | null;
  tag: PaperFileTag;
  /** The stage owner marked this as the correct paper. */
  isMain: boolean;
  uploadedBy: string | null;
  canDelete: boolean;
  /** May edit this file's details and mark it as the correct paper (stage owner or papers editor). */
  canEdit: boolean;
  /** Pre-formatted on the server. */
  when: string;
};

export function safeFileName(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(-100) || "file"
  );
}

function TagChip({ tag }: { tag: PaperFileTag }) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-xs font-medium">
      {FILE_TAG_LABEL[tag]}
    </span>
  );
}

// Pictures the browser can show (HEIC and TIFF can't, so they get an icon).
const PREVIEW = /\.(png|jpe?g|gif|webp|svg)$/i;

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** The stage owner fixes a file's name, what it is, and its remark. */
function EditFileDialog({
  file,
  paperId,
  open,
  onOpenChange,
}: {
  file: FileItem;
  paperId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(file.fileName);
  const [tag, setTag] = useState<PaperFileTag>(file.tag);
  const [note, setNote] = useState(file.note ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName(file.fileName);
          setTag(file.tag);
          setNote(file.note ?? "");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit file details</DialogTitle>
          <DialogDescription>Help the next stages see what this file is and what it&apos;s for.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await updatePaperFileAction({
                id: file.id,
                paper_id: paperId,
                file_name: name,
                tag,
                note,
              });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success(result.message);
              onOpenChange(false);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`name-${file.id}`}>Name</Label>
            <Input
              id={`name-${file.id}`}
              value={name}
              maxLength={200}
              required
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">The file type (.pdf, .jpg…) is kept.</p>
          </div>
          <div className="grid gap-2">
            <Label>What is it?</Label>
            <Select value={tag} onValueChange={(v) => setTag(v as PaperFileTag)}>
              <SelectTrigger aria-label="What is it?">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILE_TAGS.map((t) => (
                  <SelectItem key={t.tag} value={t.tag}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`note-${file.id}`}>Remark</Label>
            <div className="flex gap-2">
              <Input
                id={`note-${file.id}`}
                value={note}
                maxLength={300}
                placeholder="e.g. diagram for Q3, fixed Q12 answer"
                onChange={(e) => setNote(e.target.value)}
              />
              <TextTemplates value={note} onPick={setNote} focusId={`note-${file.id}`} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Save details
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One shared file: a preview or icon, its name, what it is, the remark, who sent it. */
export function FileRow({ file, paperId, plain = false }: { file: FileItem; paperId: string; plain?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const preview = PREVIEW.test(file.fileName);
  const Icon = IMAGE_FILE.test(file.fileName) ? ImageIcon : FileIcon;
  const canBeMain = file.canEdit && !file.isMain && PAPER_TAGS.includes(file.tag);
  const href = `/papers/files/${file.id}`;

  const run = (fn: () => Promise<Result>) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.message) toast.success(result.message);
      router.refresh();
    });

  return (
    <div className={cn("flex min-w-0 items-start gap-3", !plain && "bg-background rounded-lg border p-2.5")}>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${file.fileName}`}
        className={cn(
          "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg",
          file.isMain ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL behind a redirect
          <img src={href} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <Icon className="size-5" />
        )}
      </a>
      <div className="min-w-0 flex-1 space-y-1">
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          title={file.fileName}
          className="block truncate text-sm font-medium hover:underline"
        >
          {file.fileName}
        </a>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <TagChip tag={file.tag} />
          {file.note ? (
            <span className="min-w-0 text-sm">{file.note}</span>
          ) : (
            file.canEdit && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
                onClick={() => setEditing(true)}
              >
                Add a remark
              </button>
            )
          )}
        </div>
        <p className="text-muted-foreground truncate text-xs">
          {formatBytes(file.sizeBytes)}, sent by {file.uploadedBy ?? "someone"} {file.when}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${file.fileName}`}>
          <a href={`${href}?download=1`}>
            <DownloadIcon />
          </a>
        </Button>
        {(file.canEdit || file.canDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${file.fileName}`} disabled={pending}>
                <EllipsisVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {file.canEdit && (
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <PencilIcon /> Edit details
                </DropdownMenuItem>
              )}
              {canBeMain && (
                <DropdownMenuItem
                  onSelect={() => run(() => setMainPaperFileAction({ id: file.id, paper_id: paperId }))}
                >
                  <BadgeCheckIcon /> Mark as correct paper
                </DropdownMenuItem>
              )}
              {file.canDelete && (
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmRemove(true)}>
                  <Trash2Icon /> Remove
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {file.canEdit && <EditFileDialog file={file} paperId={paperId} open={editing} onOpenChange={setEditing} />}
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {file.fileName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {file.isMain
                ? "This is the correct paper. The next stages won't see a correct paper until you mark another one."
                : "The next stages won't see it any more."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => run(() => deletePaperFileAction({ id: file.id }))}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Paper-like tags of one family: a second one is an older copy of the correct paper.
const SAME_PAPER: PaperFileTag[] = ["paper", "corrected", "final"];
const olderCopyOf = (main: FileItem, f: FileItem) =>
  f.tag === main.tag || (SAME_PAPER.includes(f.tag) && SAME_PAPER.includes(main.tag));

/**
 * A stage's files as the next person needs them: the correct paper in its own
 * tile, then what goes with it (images, source files), and older copies folded
 * away. Files arrive correct-paper-first, then newest.
 */
export function StageFiles({ files, paperId, owner }: { files: FileItem[]; paperId: string; owner?: string | null }) {
  if (files.length === 0) return null;
  const main = files.find((f) => f.isMain) ?? null;
  const rest = files.filter((f) => f !== main);
  const older = main ? rest.filter((f) => olderCopyOf(main, f)) : [];
  const withPaper = rest.filter((f) => !older.includes(f));

  return (
    <div className="min-w-0 space-y-3">
      {main ? (
        <div className="border-success/40 bg-success/5 space-y-2 rounded-xl border p-2.5">
          <p className="text-success flex items-center gap-1.5 text-xs font-semibold">
            <BadgeCheckIcon className="size-4" /> Use this one{owner ? `, marked by ${owner}` : ""}
          </p>
          <FileRow file={main} paperId={paperId} plain />
        </div>
      ) : (
        <p className="text-sm text-amber-700 dark:text-warning">
          No file is marked as the correct paper yet{owner ? `. Ask ${owner} which one to use.` : "."}
        </p>
      )}
      {withPaper.length > 0 && (
        <div className="space-y-1.5">
          {main && (
            <p className="text-muted-foreground text-xs font-medium">Goes with the paper ({withPaper.length})</p>
          )}
          {withPaper.map((f) => (
            <FileRow key={f.id} file={f} paperId={paperId} />
          ))}
        </div>
      )}
      {older.length > 0 && (
        <details className="group space-y-1.5">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs font-medium select-none">
            Older copies ({older.length}), not the one to use
          </summary>
          <div className="space-y-1.5 pt-1.5 opacity-80">
            {older.map((f) => (
              <FileRow key={f.id} file={f} paperId={paperId} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

type Queued = {
  key: string;
  file: File;
  /** The name the next stages will see (the extension is kept). */
  name: string;
  tag: PaperFileTag;
  note: string;
  /** Object URL for a picture preview, revoked when the item leaves the list. */
  preview: string | null;
  error?: string;
};

/** Upload one or more files to a stage, each with what it is and a remark. */
export function PaperFileUploader({
  paperId,
  defaultStage,
  stages,
  mainStages = [],
  tellNext = null,
  buttonLabel = "Add files",
}: {
  paperId: string;
  defaultStage: PaperStageName;
  /** Stages that take files. One = no stage menu. */
  stages: { stage: PaperStageName; label: string }[];
  /** Stages that already have a correct paper. */
  mainStages?: string[];
  /** Names of the next stages' owners, offered "tell them" (only after the stage is finished). */
  tellNext?: string | null;
  buttonLabel?: string;
}) {
  const single = stages.length === 1;
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<PaperStageName>(defaultStage);
  const [queue, setQueue] = useState<Queued[]>([]);
  // Which queued file becomes the correct paper; null keeps the current one.
  const [mainKey, setMainKey] = useState<string | null>(null);
  const [mainTouched, setMainTouched] = useState(false);
  const [tell, setTell] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const hasMain = mainStages.includes(stage);

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const tooBig = [...list].filter((f) => f.size > MAX_PAPER_FILE_BYTES);
    if (tooBig.length > 0) toast.error(`${tooBig.map((f) => f.name).join(", ")}: files must be 25 MB or smaller.`);
    const added = [...list]
      .filter((f) => f.size <= MAX_PAPER_FILE_BYTES && f.size > 0)
      .map((file) => ({
        key: crypto.randomUUID(),
        file,
        name: file.name,
        tag: defaultFileTag(stage, file.name),
        note: "",
        preview: PREVIEW.test(file.name) ? URL.createObjectURL(file) : null,
      }));
    const next = [...queue, ...added];
    setQueue(next);
    if (!mainTouched) setMainKey(next.find((q) => PAPER_TAGS.includes(q.tag))?.key ?? null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const update = (key: string, patch: Partial<Queued>) => {
    setQueue((q) => q.map((item) => (item.key === key ? { ...item, ...patch, error: undefined } : item)));
    // Images or a source file can't be "the correct paper".
    if (key === mainKey && patch.tag && !PAPER_TAGS.includes(patch.tag)) setMainKey(null);
  };

  const remove = (key: string) => {
    const item = queue.find((q) => q.key === key);
    if (item?.preview) URL.revokeObjectURL(item.preview);
    setQueue((q) => q.filter((q2) => q2.key !== key));
    if (mainKey === key) setMainKey(null);
  };

  const uploadAll = async () => {
    setBusy(true);
    const db = createClient();
    const saved: { key: string; id: string }[] = [];
    const failed: Queued[] = [];
    for (const item of queue) {
      const path = `${paperId}/${stage}/${Date.now()}-${safeFileName(item.file.name)}`;
      const { error } = await db.storage
        .from(PAPERS_BUCKET)
        .upload(path, item.file, { contentType: item.file.type || undefined, upsert: false });
      if (error) {
        failed.push({
          ...item,
          error: /security|policy|unauthori[sz]ed|403/i.test(error.message)
            ? "Uploads are closed for this stage. Ask an admin."
            : "Could not upload. Try again.",
        });
        continue;
      }
      const result = await addPaperFileAction({
        paper_id: paperId,
        stage: stage as (typeof UPLOAD_STAGES)[number],
        storage_path: path,
        file_name: withExtension(item.name, item.file.name),
        mime_type: item.file.type || null,
        size_bytes: item.file.size,
        tag: item.tag,
        note: item.note,
      });
      if (result.ok && result.data) {
        saved.push({ key: item.key, id: result.data.id });
        if (item.preview) URL.revokeObjectURL(item.preview);
      } else failed.push({ ...item, error: result.ok ? "Could not save." : result.error });
    }

    const main = saved.find((s) => s.key === mainKey);
    if (main) {
      const result = await setMainPaperFileAction({ id: main.id, paper_id: paperId });
      if (!result.ok) toast.error(result.error);
    }
    let told = 0;
    if (tellNext && tell && saved.length > 0) {
      const result = await notifyStageFilesAction({ paper_id: paperId, stage, file_ids: saved.map((s) => s.id) });
      if (result.ok) told = result.data?.told ?? 0;
      else toast.error(result.error);
    }

    setBusy(false);
    setQueue(failed);
    setMainKey(failed.some((f) => f.key === mainKey) ? mainKey : null);
    setMainTouched(false);
    if (saved.length > 0) {
      toast.success(
        `${saved.length === 1 ? "1 file" : `${saved.length} files`} uploaded${told > 0 ? `, ${tellNext} told` : ""}`,
      );
      startTransition(() => router.refresh());
    }
    if (failed.length > 0)
      toast.error(`${failed.length} file${failed.length === 1 ? "" : "s"} not uploaded. See below.`);
  };

  return (
    <div className="space-y-3">
      {!single && (
        <div className="grid gap-1.5 sm:max-w-56">
          <Label className="text-xs">Stage</Label>
          <Select value={stage} onValueChange={(v) => setStage(v as PaperStageName)} disabled={busy}>
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

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border border-dashed p-4 text-center transition-colors sm:flex-row sm:text-left",
          dragging ? "border-primary bg-primary/5" : "bg-muted/30",
        )}
      >
        <UploadIcon className="text-muted-foreground size-5 shrink-0" />
        <p className="text-muted-foreground flex-1 text-sm">
          Drop files here, or choose several at once: the paper, its images, a corrected copy. Up to 25 MB each.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
          aria-label="Choose files"
        />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          {buttonLabel}
        </Button>
      </div>

      {queue.length > 0 && (
        <div className="space-y-2">
          <ul className="space-y-2">
            {queue.map((item) => {
              const isMain = mainKey === item.key;
              return (
                <li
                  key={item.key}
                  className={cn(
                    "space-y-2 rounded-lg border p-2.5",
                    isMain && "border-success/50 bg-success/5",
                    item.error && "border-destructive/50",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md">
                      {item.preview ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
                        <img src={item.preview} alt="" className="size-full object-cover" />
                      ) : IMAGE_FILE.test(item.file.name) ? (
                        <ImageIcon className="size-4" />
                      ) : (
                        <FileIcon className="size-4" />
                      )}
                    </div>
                    <Input
                      value={item.name}
                      maxLength={200}
                      disabled={busy}
                      className="h-8 min-w-0 flex-1 font-medium"
                      aria-label={`Name for ${item.file.name}`}
                      onChange={(e) => update(item.key, { name: e.target.value })}
                    />
                    <span className="text-muted-foreground hidden shrink-0 text-xs sm:inline">
                      {formatBytes(item.file.size)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Don't upload ${item.file.name}`}
                      disabled={busy}
                      onClick={() => remove(item.key)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[170px_1fr_auto] sm:items-center">
                    <Select value={item.tag} onValueChange={(v) => update(item.key, { tag: v as PaperFileTag })}>
                      <SelectTrigger aria-label={`What is ${item.file.name}?`} size="sm" disabled={busy}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FILE_TAGS.map((t) => (
                          <SelectItem key={t.tag} value={t.tag}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex min-w-0 gap-2">
                      <Input
                        id={`remark-${item.key}`}
                        value={item.note}
                        maxLength={300}
                        disabled={busy}
                        className="h-8"
                        aria-label={`Remark for ${item.file.name}`}
                        placeholder="Remark, e.g. images for Q3, fixed Q12"
                        onChange={(e) => update(item.key, { note: e.target.value })}
                      />
                      <TextTemplates
                        value={item.note}
                        onPick={(note) => update(item.key, { note })}
                        disabled={busy}
                        focusId={`remark-${item.key}`}
                      />
                    </div>
                    {PAPER_TAGS.includes(item.tag) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={isMain ? "success" : "outline"}
                        aria-pressed={isMain}
                        disabled={busy}
                        onClick={() => {
                          setMainTouched(true);
                          setMainKey(isMain ? null : item.key);
                        }}
                      >
                        <BadgeCheckIcon /> {isMain ? "Correct paper" : "Make correct paper"}
                      </Button>
                    ) : (
                      <span className="hidden sm:block" />
                    )}
                  </div>
                  {item.error && <p className="text-destructive text-xs">{item.error}</p>}
                </li>
              );
            })}
          </ul>

          <p className="text-muted-foreground text-xs">
            {mainKey
              ? "The next stages will see the green file first, as the one to use."
              : hasMain
                ? "The current correct paper stays. The new files show under it."
                : "No correct paper chosen. Pick the file the next stages should use."}
          </p>

          {tellNext && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={tell} onCheckedChange={(v) => setTell(v === true)} disabled={busy} />
              Tell {tellNext} about these files
            </label>
          )}

          <Button type="button" disabled={busy} onClick={() => void uploadAll()}>
            {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            {busy ? "Uploading…" : `Upload ${queue.length === 1 ? "1 file" : `${queue.length} files`}`}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Every file on the paper, by stage: the correct paper first, then the rest. */
export function PaperFileList({
  files,
  paperId,
  owners,
}: {
  files: FileItem[];
  paperId: string;
  owners: Partial<Record<string, string | null>>;
}) {
  if (files.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No files yet. Share drafts here until the English type setting is done.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {STAGES.filter((s) => files.some((f) => f.stage === s.stage)).map((s) => (
        <section key={s.stage} className="space-y-2">
          <h3 className="text-sm font-semibold">
            {STAGE_LABEL[s.stage]}
            {owners[s.stage] && <span className="text-muted-foreground font-normal"> · {owners[s.stage]}</span>}
          </h3>
          <StageFiles files={files.filter((f) => f.stage === s.stage)} paperId={paperId} />
        </section>
      ))}
    </div>
  );
}
