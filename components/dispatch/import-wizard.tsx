"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  applyImportAction,
  previewImportAction,
  startImportAction,
  type ImportPreview,
  type ImportStart,
} from "@/lib/actions/dispatch";
import { issuesCsv, MAX_IMPORT_BYTES, STUDENT_FIELDS, type Mapping, type RowStatus } from "@/lib/dispatch/import";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { useT } from "@/components/dispatch/lang";
import { plural } from "@/lib/dispatch/i18n";
const STEPS = ["Upload", "Match columns", "Check", "Preview", "Confirm"] as const;

const STATUS: Record<
  RowStatus,
  { label: string; variant: "success" | "secondary" | "outline" | "warning" | "destructive" }
> = {
  new: { label: "New", variant: "success" },
  updated: { label: "Updated", variant: "secondary" },
  unchanged: { label: "Unchanged", variant: "outline" },
  review: { label: "Needs review", variant: "warning" },
  invalid: { label: "Invalid", variant: "destructive" },
};

const NONE = "none";
const REF = "ref:";

function StepBar({ step }: { step: number }) {
  const t = useT();
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label={t("Import steps")}>
      {STEPS.map((label, i) => (
        <li key={label} className="space-y-1.5" aria-current={i === step ? "step" : undefined}>
          <div className={cn("h-1.5 rounded-full", i < step ? "bg-success" : i === step ? "bg-primary" : "bg-muted")} />
          <p className={cn("text-xs", i === step ? "font-semibold" : "text-muted-foreground")}>
            <span className="hidden sm:inline">{i + 1}. </span>
            {t(label)}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function ImportWizard({ batches }: { batches: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [start, setStart] = useState<ImportStart | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<RowStatus | "all">("all");
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);

  const step = saved !== null || confirming ? 4 : preview ? 3 : start ? 1 : 0;

  // ---------------------------------------------------------------- 1. upload
  const upload = () =>
    startTransition(async () => {
      if (!file || !batchId) return;
      const ext = file.name.toLowerCase().endsWith(".csv")
        ? "csv"
        : file.name.toLowerCase().endsWith(".xlsx")
          ? "xlsx"
          : null;
      if (!ext) return void toast.error(t("Choose an Excel (.xlsx) or CSV file."));
      if (file.size > MAX_IMPORT_BYTES) return void toast.error(t("The file is larger than 15 MB."));
      const path = `imports/${crypto.randomUUID()}.${ext}`;
      const contentType =
        ext === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const { error } = await createClient()
        .storage.from("dispatch")
        .upload(path, file, { contentType, upsert: false });
      if (error) return void toast.error(t("The upload failed. Check your connection and try again."));
      const result = await startImportAction({ path, fileName: file.name, batchId });
      if (!result.ok) return void toast.error(t(result.error));
      setStart(result.data!);
      setMapping(result.data!.mapping);
    });

  // ---------------------------------------------------------------- 2. columns → 3/4 check and preview
  const runPreview = () =>
    startTransition(async () => {
      if (!start) return;
      const result = await previewImportAction({ import_id: start.importId, mapping });
      if (!result.ok) return void toast.error(t(result.error));
      const data = result.data!;
      setPreview(data);
      setSelected(new Set(data.rows.filter((r) => r.defaultSelected).map((r) => r.line)));
      const hasProblems = data.counts.invalid + data.counts.review > 0;
      setFilter(hasProblems ? (data.counts.invalid > 0 ? "invalid" : "review") : "all");
    });

  // ---------------------------------------------------------------- 5. confirm
  const save = () =>
    startTransition(async () => {
      if (!start) return;
      const result = await applyImportAction({ import_id: start.importId, mapping, lines: [...selected] });
      if (!result.ok) {
        toast.error(t(result.error));
        setConfirming(false);
        return;
      }
      toast.success(t(result.message));
      setSaved(result.data!.saved);
      router.refresh();
    });

  const selectable = useMemo(
    () => (preview?.rows ?? []).filter((r) => r.status !== "invalid" && r.status !== "unchanged"),
    [preview],
  );
  const shown = (preview?.rows ?? []).filter((r) => filter === "all" || r.status === filter);
  const chosen = selectable.filter((r) => selected.has(r.line));
  const chosenCounts = {
    add: chosen.filter((r) => r.baseStatus === "new").length,
    update: chosen.filter((r) => r.baseStatus === "updated").length,
  };

  const downloadIssues = () => {
    if (!preview) return;
    const csv = issuesCsv(preview.rows.map((r) => ({ ...r, apply: null })));
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-problems.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const columnValue = (key: keyof Mapping) => {
    const src = mapping[key];
    if (!src) return NONE;
    return src.fromReference ? `${REF}${src.column}` : String(src.column);
  };
  const setColumn = (key: keyof Mapping, value: string) =>
    setMapping((m) => {
      const next = { ...m };
      if (value === NONE) delete next[key];
      else if (value.startsWith(REF)) next[key] = { column: Number(value.slice(REF.length)), fromReference: true };
      else next[key] = { column: Number(value) };
      return next;
    });

  return (
    <div className="space-y-6">
      <StepBar step={step} />

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("Upload the student list")}</CardTitle>
            <CardDescription>
              {t(
                "An Excel (.xlsx) or CSV file, up to 15 MB and 2,000 rows. A Citypak export works as it is. The file is kept privately and deleted automatically later. Nothing is saved to the student list until you confirm.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="import-batch">{t("Batch")}</Label>
              <Select value={batchId} onValueChange={setBatchId}>
                <SelectTrigger id="import-batch" className="w-full">
                  <SelectValue placeholder={t("Choose a batch")} />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="import-file">{t("File")}</Label>
              <Input
                id="import-file"
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={upload} disabled={!file || !batchId || pending}>
                {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} {t("Upload and read")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && start && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheetIcon className="text-primary size-5" /> {start.fileName}
            </CardTitle>
            <CardDescription>
              {t(
                "{rowCount} rows found. Check which column holds each detail; recognised columns are already chosen.",
                { rowCount: start.rowCount },
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {STUDENT_FIELDS.map((f) => {
                const src = mapping[f.key];
                const sample = src
                  ? start.sample
                      .map((r) => r[src.column])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join(" · ")
                  : "";
                const required = f.key === "student_no" || f.key === "full_name";
                return (
                  <div key={f.key} className="grid gap-1.5">
                    <Label>
                      {t(f.label)}
                      {required && <span className="text-destructive"> *</span>}
                    </Label>
                    <Select value={columnValue(f.key)} onValueChange={(v) => setColumn(f.key, v)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t("Not in this file")}</SelectItem>
                        {start.header.map((h, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {h || `Column ${i + 1}`}
                          </SelectItem>
                        ))}
                        {f.key === "student_no" &&
                          start.header.map((h, i) =>
                            /reference/i.test(h) ? (
                              <SelectItem key={`ref-${i}`} value={`${REF}${i}`}>
                                {t("Last digits of “{h}”", { h: h })}
                              </SelectItem>
                            ) : null,
                          )}
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground truncate text-xs">{sample ? `e.g. ${sample}` : " "}</p>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStart(null);
                  setFile(null);
                }}
              >
                <ArrowLeftIcon /> {t("Choose another file")}
              </Button>
              <Button onClick={runPreview} disabled={!mapping.student_no || !mapping.full_name || pending}>
                {pending ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />} {t("Check rows")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && saved === null && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn(
                "rounded-lg border p-3 text-left",
                filter === "all" && "border-primary ring-primary/30 ring-2",
              )}
            >
              <p className="text-2xl font-semibold tabular-nums">{preview.rows.length}</p>
              <p className="text-muted-foreground text-xs">{t("All rows")}</p>
            </button>
            {(Object.keys(STATUS) as RowStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={cn(
                  "rounded-lg border p-3 text-left",
                  filter === s && "border-primary ring-primary/30 ring-2",
                )}
              >
                <p className="text-2xl font-semibold tabular-nums">{preview.counts[s]}</p>
                <p className="text-muted-foreground text-xs">{t(STATUS[s].label)}</p>
              </button>
            ))}
          </div>

          {!confirming && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreview(null)} disabled={pending}>
                  <ArrowLeftIcon /> {t("Change columns")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSelected(
                      new Set(
                        selectable.filter((r) => r.baseStatus === "new" && r.status === "new").map((r) => r.line),
                      ),
                    )
                  }
                >
                  {t("Tick all new")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
                  {t("Untick all")}
                </Button>
                {preview.counts.invalid + preview.counts.review > 0 && (
                  <Button variant="outline" size="sm" onClick={downloadIssues}>
                    <DownloadIcon /> {t("Problems (CSV)")}
                  </Button>
                )}
              </div>
              <Button onClick={() => setConfirming(true)} disabled={chosen.length === 0}>
                {t("Review {length} ticked", { length: chosen.length })} <ArrowRightIcon />
              </Button>
            </div>
          )}

          {confirming && (
            <Card className="border-primary/40">
              <CardHeader>
                <CardTitle>{t("Save these changes?")}</CardTitle>
                <CardDescription>
                  {t("{add} new, {update} updated.", { add: chosenCounts.add, update: chosenCounts.update })}{" "}
                  {t(
                    "Unticked rows are left as they are. If someone changed a student since this preview, nothing is saved and you'll be asked to check again.",
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
                  <ArrowLeftIcon /> {t("Back")}
                </Button>
                <Button onClick={save} disabled={pending}>
                  {pending ? <Loader2Icon className="animate-spin" /> : <CheckCircle2Icon />}{" "}
                  {t(plural(chosen.length, "Save {n} row", "Save {n} rows"), { n: chosen.length })}
                </Button>
              </CardContent>
            </Card>
          )}

          <ImportPreviewTable
            rows={shown}
            selected={selected}
            locked={confirming}
            onToggle={(line, on) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (on) next.add(line);
                else next.delete(line);
                return next;
              })
            }
          />
        </>
      )}

      {saved !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2Icon className="text-success size-5" />{" "}
              {t(plural(saved, "Saved {n} student record", "Saved {n} student records"), { n: saved })}
            </CardTitle>
            <CardDescription>
              {preview && preview.counts.invalid + preview.counts.review > 0
                ? t(
                    "Rows you didn't tick were not changed. Download the problems list to fix them in the file and import again.",
                  )
                : t("Rows you didn't tick were not changed.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/admin/dispatch/students">{t("Open students")}</Link>
            </Button>
            {preview && preview.counts.invalid + preview.counts.review > 0 && (
              <Button variant="outline" onClick={downloadIssues}>
                <DownloadIcon /> {t("Problems (CSV)")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** The checked rows of an import, with old → new for changes. Display only. */
export function ImportPreviewTable({
  rows,
  selected,
  onToggle,
  locked,
}: {
  rows: ImportPreview["rows"];
  selected: Set<number>;
  onToggle: (line: number, on: boolean) => void;
  locked?: boolean;
}) {
  const t = useT();
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 pl-4">
              <span className="sr-only">{t("Save")}</span>
            </TableHead>
            <TableHead className="w-14">{t("Row")}</TableHead>
            <TableHead>{t("Student")}</TableHead>
            <TableHead>{t("Status")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("Details")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground py-6 text-center text-sm">
                {t("No rows here.")}
              </TableCell>
            </TableRow>
          )}
          {rows.map((r) => {
            const canPick = r.status !== "invalid" && r.status !== "unchanged";
            return (
              <TableRow key={r.line} data-state={selected.has(r.line) ? "selected" : undefined}>
                <TableCell className="pl-4">
                  <Checkbox
                    aria-label={t("Save row {n}", { n: r.line })}
                    disabled={!canPick || locked}
                    checked={selected.has(r.line)}
                    onCheckedChange={(v) => onToggle(r.line, v === true)}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground text-xs tabular-nums">{r.line}</TableCell>
                <TableCell>
                  <p className="font-mono text-sm">{r.studentNo || "—"}</p>
                  <p className="max-w-[180px] truncate text-sm sm:max-w-[260px]">{r.name || "—"}</p>
                  <div className="mt-1 max-w-[220px] space-y-1 text-xs whitespace-normal md:hidden">
                    <RowDetails row={r} />
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS[r.status].variant}>{t(STATUS[r.status].label)}</Badge>
                  {r.status === "review" && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {r.baseStatus === "updated" ? t("Update") : t("New")}
                    </p>
                  )}
                </TableCell>
                <TableCell className="hidden max-w-[420px] space-y-1 text-xs md:table-cell">
                  <RowDetails row={r} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function RowDetails({ row }: { row: ImportPreview["rows"][number] }) {
  const t = useT();
  return (
    <>
      {row.errors.map((e) => (
        <p key={e} className="text-destructive flex gap-1">
          <XCircleIcon className="mt-0.5 size-3.5 shrink-0" /> {t(e)}
        </p>
      ))}
      {row.warnings.map((w) => (
        <p key={w} className="flex gap-1 text-amber-700 dark:text-warning">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" /> {t(w)}
        </p>
      ))}
      {row.changes.map((c) => (
        <p key={c.field}>
          <span className="font-medium">{t(c.label)}:</span>{" "}
          <span className="text-muted-foreground line-through">{c.from || t("empty")}</span> → {c.to}
        </p>
      ))}
    </>
  );
}
