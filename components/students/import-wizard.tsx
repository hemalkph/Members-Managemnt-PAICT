"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangleIcon, DownloadIcon, FileUpIcon, Loader2Icon, UploadIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { importPaymentsAction, importStudentsAction } from "@/lib/actions/student-import";
import { parseCsv } from "@/lib/students/csv";
import {
  checkPaymentRows,
  checkStudentRows,
  type ExistingStudent,
  type PaymentPayload,
  type Preview,
  type PreviewRow,
  type StudentPayload,
} from "@/lib/students/import";
import type { ConcessionCard } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type Props =
  | {
      kind: "students";
      batches: { id: string; name: string }[];
      centres: { id: string; name: string }[];
      existing: ExistingStudent[];
    }
  | {
      kind: "payments";
      students: { id: string; studentNo: string; fullName: string; card: ConcessionCard }[];
      /** [ "<student id>:<YYYY-MM>", status, amount ] */
      payments: [string, "paid" | "unpaid", number | null][];
      thisMonth: string;
    };

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const KIND_BADGE = { new: "success", existing: "secondary", error: "destructive" } as const;
const KIND_LABEL = { new: "New", existing: "Skipped", error: "Error" } as const;

/** Download the template, choose the filled-in CSV, check the preview, import. */
export function ImportWizard(props: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; table: string[][] } | null>(null);
  const [show, setShow] = useState<"all" | "new" | "existing" | "error">("all");
  const [pending, startTransition] = useTransition();
  const noun = props.kind === "students" ? "student" : "payment";

  const preview = useMemo((): Preview<StudentPayload | PaymentPayload> | null => {
    if (!file) return null;
    if (props.kind === "students") {
      return checkStudentRows(file.table, { batches: props.batches, centres: props.centres, existing: props.existing });
    }
    return checkPaymentRows(file.table, {
      students: props.students,
      existing: new Map(props.payments.map(([key, status, amount]) => [key, { status, amount }])),
      thisMonth: props.thisMonth,
    });
  }, [file, props]);

  const rows = preview?.rows ?? [];
  const count = (k: PreviewRow<unknown>["kind"]) => rows.filter((r) => r.kind === k).length;
  const fresh = rows.filter((r) => r.kind === "new");

  const choose = async (list: FileList | null) => {
    const f = list?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) return toast.error("Choose a .csv file. In Excel: File → Save As → CSV UTF-8.");
    if (f.size > MAX_FILE_BYTES) return toast.error("The file is over 5 MB.");
    setFile({ name: f.name, table: parseCsv(await f.text()) });
    setShow("all");
  };

  const runImport = () =>
    startTransition(async () => {
      const payloads = fresh.map((r) => (r.kind === "new" ? r.payload : null)).filter((p) => p !== null);
      const result =
        props.kind === "students"
          ? await importStudentsAction({ file_name: file!.name, rows: payloads as StudentPayload[] })
          : await importPaymentsAction({ file_name: file!.name, rows: payloads as PaymentPayload[] });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setFile(null);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1. Get the template</CardTitle>
          <CardDescription>
            {props.kind === "students"
              ? "One row per student, up to two parents. Batch and centre names must match Batches & exams. The EXAMPLE row is ignored."
              : "One row per student and month. status is paid or unpaid; paid needs the amount. The EXAMPLE row is ignored."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a href={`/admin/students/import/template?kind=${props.kind}`}>
              <DownloadIcon /> Download {noun}s template
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Choose the filled-in CSV</CardTitle>
          <CardDescription>
            In Excel: File → Save As → <span className="font-medium">CSV UTF-8</span>. The file is read in your browser and
            is not uploaded; delete your copy when you are done, it holds family details.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <FileUpIcon /> {file ? "Choose another file" : "Choose CSV file"}
          </Button>
          {file && (
            <span className="bg-muted inline-flex max-w-full items-center gap-1 rounded-md py-1 pr-1 pl-2 text-sm">
              <span className="truncate">{file.name}</span>
              <Button variant="ghost" size="icon" className="size-6" aria-label="Remove file" onClick={() => setFile(null)}>
                <XIcon className="size-3" />
              </Button>
            </span>
          )}
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="CSV file" onChange={(e) => void choose(e.target.files)} />
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>3. Check and import</CardTitle>
            {!preview.fileError && (
              <div className="flex flex-wrap gap-1.5 pt-1" role="group" aria-label="Show rows">
                {(
                  [
                    ["all", `All ${rows.length}`],
                    ["new", `${count("new")} new`],
                    ["existing", `${count("existing")} already ${props.kind === "students" ? "registered" : "recorded"}`],
                    ["error", `${count("error")} with errors`],
                  ] as const
                ).map(([k, label]) => (
                  <Button key={k} size="sm" variant={show === k ? "default" : "outline"} className="h-7" onClick={() => setShow(k)}>
                    {label}
                  </Button>
                ))}
                {preview.ignored > 0 && <span className="text-muted-foreground self-center text-xs">Example row ignored</span>}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.fileError ? (
              <p className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg p-3 text-sm">
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" /> {preview.fileError}
              </p>
            ) : rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">No rows to import. Fill in the template below the header row.</p>
            ) : (
              <div className="max-h-[60svh] overflow-auto rounded-lg border">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-muted/50 text-muted-foreground sticky top-0 text-[11px] tracking-wide uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Row</th>
                      <th className="px-3 py-2 text-left font-semibold">Student ID</th>
                      <th className="px-3 py-2 text-left font-semibold">In your file</th>
                      <th className="px-3 py-2 text-left font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .filter((r) => show === "all" || r.kind === show)
                      .map((r) => (
                        <tr key={`${r.line}`} className={cn("border-t align-top", r.kind === "error" && "bg-destructive/5")}>
                          <td className="text-muted-foreground px-3 py-2 tabular-nums">{r.line}</td>
                          <td className="px-3 py-2 font-medium">{r.key.split("·")[0]}</td>
                          <td className="px-3 py-2 break-words">{r.summary}</td>
                          <td className="px-3 py-2">
                            <Badge variant={KIND_BADGE[r.kind]}>{KIND_LABEL[r.kind]}</Badge>
                            {r.kind === "existing" && (
                              <p className="text-muted-foreground mt-1 text-xs">
                                {props.kind === "students" ? "In the system: " : "Recorded: "}
                                {r.existing}
                              </p>
                            )}
                            {r.kind === "error" && (
                              <ul className="text-destructive mt-1 list-disc pl-4 text-xs">
                                {r.errors.map((e) => (
                                  <li key={e}>{e}</li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            {!preview.fileError && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-muted-foreground text-sm">
                  {count("error") > 0
                    ? `${count("error")} row${count("error") === 1 ? "" : "s"} with errors will be left out. Fix them in the file and choose it again to include them.`
                    : count("existing") > 0
                      ? `Rows already ${props.kind === "students" ? "registered" : "recorded"} are skipped and not changed.`
                      : props.kind === "students"
                        ? "Imported students start as Applied: upload each GN certificate, then verify."
                        : ""}
                </p>
                <Button disabled={fresh.length === 0 || pending} onClick={runImport}>
                  {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
                  Import {fresh.length} {noun}
                  {fresh.length === 1 ? "" : "s"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
