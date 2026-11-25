"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangleIcon, FileUpIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { uploadPostListAction } from "@/lib/actions/post";
import { formatDateTime } from "@/lib/core/format";
import { monthLabel } from "@/lib/core/month";
import { parseStudentCsv, parseStudentXlsx, type ParsedStudentRecord } from "@/lib/fees/parse-sheet";
import type { PostList } from "@/lib/post/queries";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Upload the students to post to this month for one class (apart from the Fee reminders paid list). */
export function PostListDialog({
  month,
  lists,
  initialClassId,
  onClose,
}: {
  month: string;
  lists: PostList[];
  initialClassId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [classId, setClassId] = useState(initialClassId ?? (lists.length === 1 ? lists[0].classId : ""));
  const [file, setFile] = useState<{ name: string; students: ParsedStudentRecord[] } | null>(null);
  const [reading, setReading] = useState(false);
  const [pending, startTransition] = useTransition();

  const current = lists.find((l) => l.classId === classId);
  const noAddress = useMemo(() => (file ? file.students.filter((s) => !s.address) : []), [file]);

  const chooseFile = async (list: FileList | null) => {
    const f = list?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) return void toast.error("Choose an Excel (.xlsx) or CSV (.csv) file.");
    if (f.size > MAX_FILE_BYTES) return void toast.error("File is larger than 10 MB.");

    setReading(true);
    try {
      const parsed = /\.xlsx$/i.test(f.name)
        ? await parseStudentXlsx(await f.arrayBuffer(), f.name)
        : parseStudentCsv(await f.text(), f.name);
      // The class is picked here, so a Classes column in the file doesn't matter: take everyone once.
      const byKey = new Map<string, ParsedStudentRecord>();
      for (const g of parsed.groups) for (const s of g.students) if (!byKey.has(s.student_key)) byKey.set(s.student_key, s);
      if (byKey.size === 0) {
        toast.error("No students found. The file needs a Name column and a WhatsApp, Mobile or Email column.");
        return;
      }
      setFile({ name: f.name, students: [...byKey.values()] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read this file.");
    } finally {
      setReading(false);
    }
  };

  const save = () => {
    if (!file || !classId) return;
    startTransition(async () => {
      const res = await uploadPostListAction({
        class_id: classId,
        month,
        file_name: file.name,
        rows: file.students.map((s) => ({
          student_key: s.student_key,
          full_name: s.full_name,
          whatsapp: s.whatsapp_norm ?? s.mobile_norm,
          address: s.address,
          district: s.district,
        })),
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Speed Post list · {monthLabel(month)}</DialogTitle>
          <DialogDescription>
            Only the students to post to this month. Everyone on the list gets the class&apos;s {monthLabel(month, "short")}{" "}
            tutes. Separate from the Fee reminders paid list.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="post-list-class">Class</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger id="post-list-class" className="w-full">
                <SelectValue placeholder="Choose a class" />
              </SelectTrigger>
              <SelectContent>
                {lists.map((l) => (
                  <SelectItem key={l.classId} value={l.classId}>
                    {l.className}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {current?.uploadedAt && (
              <p className="text-muted-foreground text-xs">
                Replaces the current list ({current.students} students, {formatDateTime(current.uploadedAt)}). Tutes
                already posted are never sent twice.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-dashed p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm font-medium">{file ? file.name : "Choose the list file"}</p>
                <p className="text-muted-foreground text-xs">
                  Excel (.xlsx) or CSV: Name, WhatsApp or Mobile, Address and Nearest City.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={reading} onClick={() => inputRef.current?.click()}>
                {reading ? <Loader2Icon className="animate-spin" /> : <FileUpIcon />}
                {file ? "Choose another file" : "Choose file"}
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                aria-label="Speed Post list file"
                onChange={(e) => void chooseFile(e.target.files)}
              />
            </div>

            {file && (
              <div className="mt-3 space-y-2 text-sm">
                <p className="tabular-nums">
                  <span className="font-semibold">{file.students.length}</span> student
                  {file.students.length === 1 ? "" : "s"} ·{" "}
                  <span className="font-semibold">{file.students.length - noAddress.length}</span> with an address
                </p>
                {noAddress.length > 0 && (
                  <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-warning">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    <p>
                      {noAddress.length === file.students.length
                        ? "No addresses found. Check the file has an Address column."
                        : `No address for ${noAddress.slice(0, 6).map((s) => s.full_name).join(", ")}${noAddress.length > 6 ? ` and ${noAddress.length - 6} more` : ""}. Add them on the Addresses tab after uploading.`}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Close
          </Button>
          <Button type="button" onClick={save} disabled={pending || !file || !classId}>
            {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            {current?.uploadedAt ? "Replace list" : "Save list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
