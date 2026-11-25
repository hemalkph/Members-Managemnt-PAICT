"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  FileSpreadsheetIcon,
  FileUpIcon,
  InfoIcon,
  Loader2Icon,
  LayersIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { importFeeMonthAction } from "@/lib/actions/fees";
import { monthLabel } from "@/lib/core/month";
import {
  formatExcludedSummary,
  parseStudentCsv,
  parseStudentXlsx,
  type DetectedClassGroup,
  type ParsedUploadFile,
} from "@/lib/fees/parse-sheet";
import { formatPhoneDisplay, pickContactPhone } from "@/lib/fees/phone";
import type { FeeClassItem } from "@/lib/fees/queries";
import { cn } from "@/lib/utils";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

type GroupMapping = {
  include: boolean;
  /** Existing fee_class ID, or "__new__" to create a new class inside the selected batch. */
  target: string;
  newName: string;
};

function buildMonthOptions(baseMonth: string): string[] {
  const [y, m] = baseMonth.split("-").map(Number);
  const out: string[] = [];
  for (let delta = 1; delta >= -18; delta--) {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function guessMonthKey(currentMonthKey: string, hintedMonthNumber: number | null): string {
  if (!hintedMonthNumber) return currentMonthKey;
  const [cy, cm] = currentMonthKey.split("-").map(Number);
  // Pick the closest year (same year, or previous year if e.g. current is Jan and sheet is Dec).
  let year = cy;
  if (hintedMonthNumber - cm > 4) year = cy - 1;
  else if (cm - hintedMonthNumber > 8) year = cy + 1;
  return `${year}-${String(hintedMonthNumber).padStart(2, "0")}`;
}

function matchBatchId(
  batches: { id: string; name: string }[],
  batchHint: string | null,
  fallbackBatchId: string,
): string {
  if (batchHint) {
    const h = batchHint.trim().toLowerCase();
    const exact = batches.find((b) => b.name.trim().toLowerCase() === h);
    if (exact) return exact.id;
    const yearMatch = h.match(/\b(20\d{2})\b/)?.[1];
    if (yearMatch) {
      const partial = batches.find((b) => b.name.includes(yearMatch));
      if (partial) return partial.id;
    }
  }
  return fallbackBatchId || batches[0]?.id || "";
}

function initialMappings(
  groups: DetectedClassGroup[],
  batchClasses: FeeClassItem[],
  activeClassId: string | null,
): GroupMapping[] {
  return groups.map((g) => {
    const detected = g.detectedName.trim();
    if (!detected) {
      // Export had no Classes column -> map to active class if available.
      return {
        include: true,
        target: activeClassId && batchClasses.some((c) => c.id === activeClassId) ? activeClassId : "__new__",
        newName: "",
      };
    }
    const existing = batchClasses.find((c) => c.name.trim().toLowerCase() === detected.toLowerCase());
    if (existing) {
      return { include: true, target: existing.id, newName: detected };
    }
    // Never blindly overwrite a differently named active class — create its own isolated class instead!
    return { include: true, target: "__new__", newName: detected };
  });
}

export function UploadMonthDialog({
  batches,
  classes,
  defaultBatchId,
  activeClassId,
  defaultMonth,
  onImported,
  children,
}: {
  batches: { id: string; name: string; isActive: boolean }[];
  classes: FeeClassItem[];
  defaultBatchId: string;
  activeClassId: string | null;
  defaultMonth: string;
  onImported?: (result: { batchId: string; classId: string; month: string }) => void;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [batchId, setBatchId] = useState(defaultBatchId || batches[0]?.id || "");
  const [month, setMonth] = useState(defaultMonth);
  const [parsed, setParsed] = useState<ParsedUploadFile | null>(null);
  const [mappings, setMappings] = useState<GroupMapping[]>([]);
  const [reading, setReading] = useState(false);
  const [pending, startTransition] = useTransition();

  const monthOptions = useMemo(() => {
    const list = buildMonthOptions(defaultMonth);
    if (!list.includes(month)) list.unshift(month);
    return list;
  }, [defaultMonth, month]);

  const batchClasses = useMemo(() => classes.filter((c) => c.batchId === batchId), [classes, batchId]);
  const activeClass = useMemo(() => classes.find((c) => c.id === activeClassId) ?? null, [classes, activeClassId]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      const b = defaultBatchId || batches[0]?.id || "";
      setBatchId(b);
      setMonth(defaultMonth);
      setParsed(null);
      setMappings([]);
    }
  };

  const handleBatchChange = (nextBatchId: string) => {
    setBatchId(nextBatchId);
    if (parsed) {
      const nextClasses = classes.filter((c) => c.batchId === nextBatchId);
      setMappings(initialMappings(parsed.groups, nextClasses, activeClassId));
    }
  };

  const chooseFile = async (list: FileList | null) => {
    const f = list?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) {
      toast.error("Choose an Excel (.xlsx) or CSV (.csv) file.");
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      toast.error("File is larger than 10 MB.");
      return;
    }

    setReading(true);
    try {
      const result = /\.xlsx$/i.test(f.name)
        ? await parseStudentXlsx(await f.arrayBuffer(), f.name)
        : parseStudentCsv(await f.text(), f.name);

      const guessedBatch = matchBatchId(batches, result.batchHint, batchId);
      const guessedMonth = guessMonthKey(defaultMonth, result.monthNumberHint);
      const nextBatchClasses = classes.filter((c) => c.batchId === guessedBatch);

      setBatchId(guessedBatch);
      setMonth(guessedMonth);
      setParsed(result);
      setMappings(initialMappings(result.groups, nextBatchClasses, activeClassId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read this file.");
    } finally {
      setReading(false);
    }
  };

  const updateMapping = (idx: number, patch: Partial<GroupMapping>) => {
    setMappings((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  };

  // Detect any target-class collisions (non-overlap guard!).
  const selectedEntries = useMemo(() => {
    if (!parsed) return [];
    return parsed.groups
      .map((group, idx) => ({ group, mapping: mappings[idx], idx }))
      .filter((x) => x.mapping?.include);
  }, [parsed, mappings]);

  const conflictReason = useMemo(() => {
    const seen = new Set<string>();
    for (const { mapping } of selectedEntries) {
      if (mapping.target === "__new__") {
        const clean = mapping.newName.trim().toLowerCase();
        if (clean.length < 2) return "Enter a class name (at least 2 characters) for every new class.";
        const existing = batchClasses.find((c) => c.name.trim().toLowerCase() === clean);
        const key = existing ? `id:${existing.id}` : `new:${clean}`;
        if (seen.has(key)) {
          return "Two selected classes map to the same target class. Map each class separately so student lists do not overlap.";
        }
        seen.add(key);
      } else {
        const key = `id:${mapping.target}`;
        if (seen.has(key)) {
          return "Two selected classes map to the same target class. Map each class separately so student lists do not overlap.";
        }
        seen.add(key);
      }
    }
    return null;
  }, [selectedEntries, batchClasses]);

  // Warn if a user opened Upload from Class A, and the uploaded file's class looks like Class B.
  const activeMismatchNotice = useMemo(() => {
    if (!parsed || !activeClass || parsed.groups.length !== 1) return null;
    const detected = parsed.groups[0].detectedName.trim();
    if (!detected) return null;
    if (detected.toLowerCase() === activeClass.name.trim().toLowerCase()) return null;
    return `This file looks like "${detected}", not "${activeClass.name}". We kept it separate so "${activeClass.name}" is not overwritten.`;
  }, [parsed, activeClass]);

  const runImport = () => {
    if (!parsed || selectedEntries.length === 0 || conflictReason) return;
    startTransition(async () => {
      const res = await importFeeMonthAction({
        batch_id: batchId,
        month,
        file_name: parsed.fileName,
        groups: selectedEntries.map(({ group, mapping }) => ({
          class_id: mapping.target === "__new__" ? "" : mapping.target,
          new_class_name: mapping.target === "__new__" ? mapping.newName.trim() : "",
          raw_row_count: group.rawRowCount,
          duplicates_merged: group.duplicatesMerged,
          rows: group.students.map((s) => ({
            student_key: s.student_key,
            full_name: s.full_name,
            email_norm: s.email_norm,
            raw_email: s.raw_email,
            whatsapp_norm: s.whatsapp_norm,
            raw_whatsapp: s.raw_whatsapp,
            mobile_norm: s.mobile_norm,
            raw_mobile: s.raw_mobile,
            institute: s.institute,
            district: s.district,
            is_new_student: s.is_new_student,
            amount: s.amount,
            export_label: s.export_label,
            raw_classes: s.raw_classes,
          })),
        })),
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setOpen(false);
      if (res.data?.primaryClassId && onImported) {
        onImported({ batchId, classId: res.data.primaryClassId, month });
      }
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children ?? (
          <Button>
            <FileUpIcon /> Upload month (.xlsx / .csv)
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheetIcon className="size-5 text-emerald-600 dark:text-emerald-400" />
            Upload monthly paid list
          </DialogTitle>
          <DialogDescription>
            Supports standard Paid Student exports and Enrollment exports (.xlsx or .csv). Multi-class files are split
            automatically with zero overlap, and rejected/failed/revoked attempts are excluded before counting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Batch & Month pickers */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="upload-batch">Batch</Label>
              <Select value={batchId} onValueChange={handleBatchChange}>
                <SelectTrigger id="upload-batch">
                  <SelectValue placeholder="Choose a batch" />
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
            <div className="space-y-1.5">
              <Label htmlFor="upload-month">Paid month</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger id="upload-month">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {monthLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* File chooser */}
          <div className="rounded-xl border border-dashed p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Choose monthly export file</p>
                <p className="text-muted-foreground text-xs">
                  Excel (.xlsx) or CSV (.csv). Extra &ldquo;New Students&rdquo;, &ldquo;Summary&rdquo;, report footers,
                  and rejected/failed/revoked payment rows are skipped automatically.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={reading} onClick={() => inputRef.current?.click()}>
                {reading ? <Loader2Icon className="animate-spin" /> : <FileUpIcon />}
                {parsed ? "Choose another file" : "Choose file"}
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                aria-label="Monthly paid student file"
                onChange={(e) => void chooseFile(e.target.files)}
              />
            </div>

            {parsed && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs">
                <Badge variant="secondary" className="gap-1">
                  <FileSpreadsheetIcon className="size-3" />
                  {parsed.fileName}
                  <button
                    type="button"
                    aria-label="Clear selected file"
                    className="ml-1 hover:opacity-75"
                    onClick={() => {
                      setParsed(null);
                      setMappings([]);
                    }}
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
                {parsed.sheetName && <Badge variant="outline">Sheet: {parsed.sheetName}</Badge>}
                {parsed.skippedExtraSections && (
                  <Badge variant="outline" className="text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2Icon className="size-3" /> Ignored extra sections / report footer
                  </Badge>
                )}
                {parsed.excludedRows.total > 0 && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 text-amber-800 dark:text-amber-300"
                    title={
                      parsed.excludedRows.sampleNames.length > 0
                        ? `Excluded rows for: ${parsed.excludedRows.sampleNames.join(", ")}`
                        : undefined
                    }
                  >
                    Filtered out {parsed.excludedRows.total} non-paid row{parsed.excludedRows.total === 1 ? "" : "s"} (
                    {formatExcludedSummary(parsed.excludedRows)})
                  </Badge>
                )}
                {parsed.groups.length > 1 && (
                  <Badge variant="warning">
                    <LayersIcon className="size-3" /> {parsed.groups.length} classes detected in one file
                  </Badge>
                )}
              </div>
            )}
          </div>

          {activeMismatchNotice && (
            <div className="bg-warning/15 flex items-start gap-2 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{activeMismatchNotice}</span>
            </div>
          )}

          {parsed?.warnings.map((w) => (
            <div key={w} className="bg-muted flex items-start gap-2 rounded-lg p-3 text-xs">
              <InfoIcon className="mt-0.5 size-4 shrink-0" />
              <span>{w}</span>
            </div>
          ))}

          {/* Detected class groups (hybrid single or multi-class mapping) */}
          {parsed && parsed.groups.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">
                  Detected class{parsed.groups.length === 1 ? "" : "es"} ({selectedEntries.length} selected)
                </p>
                <p className="text-muted-foreground text-xs">Each class saves to its own isolated monthly list.</p>
              </div>

              {parsed.groups.map((group, idx) => {
                const map = mappings[idx];
                if (!map) return null;
                const existingTarget = batchClasses.find((c) => c.id === map.target);
                const alreadyHasMonth = existingTarget?.months.some((m) => m.month === month);

                return (
                  <div
                    key={`${group.detectedName || "default"}-${idx}`}
                    className={cn(
                      "space-y-3 rounded-xl border p-3.5 transition-opacity",
                      !map.include && "opacity-55",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <Checkbox
                        id={`grp-${idx}`}
                        checked={map.include}
                        onCheckedChange={(v) => updateMapping(idx, { include: Boolean(v) })}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <label htmlFor={`grp-${idx}`} className="cursor-pointer text-sm font-semibold">
                            {group.detectedName || "Unnamed class in file"}
                          </label>
                          <Badge variant="success">{group.students.length} unique paid students</Badge>
                          {group.excludedRows.total > 0 && (
                            <Badge
                              variant="outline"
                              title={
                                group.excludedRows.sampleNames.length > 0
                                  ? `Skipped non-paid rows: ${group.excludedRows.sampleNames.join(", ")}`
                                  : undefined
                              }
                            >
                              {group.excludedRows.total} excluded ({formatExcludedSummary(group.excludedRows)})
                            </Badge>
                          )}
                          {group.duplicatesMerged > 0 && (
                            <Badge
                              variant="warning"
                              title={`Merged duplicate paid rows: ${group.mergedNames.join(", ")}`}
                            >
                              {group.duplicatesMerged} duplicate{group.duplicatesMerged === 1 ? "" : "s"} merged
                            </Badge>
                          )}
                          {group.missingPhoneCount > 0 && (
                            <Badge variant="outline">{group.missingPhoneCount} missing WhatsApp</Badge>
                          )}
                        </div>
                        {group.rawSample && (
                          <p className="text-muted-foreground truncate text-xs">From file: {group.rawSample}</p>
                        )}
                        {group.excludedRows.total > 0 && (
                          <p className="text-muted-foreground text-xs">
                            Auto-skipped {formatExcludedSummary(group.excludedRows)} payment attempt
                            {group.excludedRows.total === 1 ? "" : "s"} before counting unique paid students.
                          </p>
                        )}
                        {group.mergedNames.length > 0 && (
                          <p className="text-muted-foreground text-xs">
                            Same-month duplicates combined: {group.mergedNames.slice(0, 4).join(", ")}
                            {group.mergedNames.length > 4 ? ` +${group.mergedNames.length - 4} more` : ""}
                          </p>
                        )}
                      </div>
                    </div>

                    {map.include && (
                      <div className="grid gap-2.5 pl-6 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Save into class</Label>
                          <Select
                            value={map.target}
                            onValueChange={(v) => updateMapping(idx, { target: v })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__new__">+ Create new class in this batch</SelectItem>
                              {batchClasses.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {map.target === "__new__" && (
                          <div className="space-y-1">
                            <Label className="text-xs">New class name</Label>
                            <Input
                              value={map.newName}
                              onChange={(e) => updateMapping(idx, { newName: e.target.value })}
                              placeholder="e.g. 2027 Grand Revision"
                              className="h-8 text-xs"
                              maxLength={120}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {map.include && alreadyHasMonth && (
                      <p className="text-muted-foreground pl-6 text-xs">
                        <span className="font-medium text-foreground">Updating {monthLabel(month)}:</span> Newly paid
                        students will automatically clear from Due, while existing WhatsApp follow-ups stay saved.
                      </p>
                    )}

                    {/* Mini preview of first 4 students */}
                    {map.include && group.students.length > 0 && (
                      <div className="overflow-x-auto pl-6">
                        <table className="w-full text-xs">
                          <thead className="text-muted-foreground border-b text-left">
                            <tr>
                              <th className="py-1 pr-2 font-medium">Student</th>
                              <th className="py-1 pr-2 font-medium">WhatsApp</th>
                              <th className="py-1 font-medium">Label / Fee</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.students.slice(0, 4).map((s) => {
                              const phone = pickContactPhone(s.whatsapp_norm);
                              return (
                                <tr key={s.student_key} className="border-b last:border-0">
                                  <td className="py-1 pr-2">
                                    <span className="font-medium">{s.full_name}</span>
                                    {s.raw_email && (
                                      <span className="text-muted-foreground block truncate text-[11px]">
                                        {s.raw_email}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-1 pr-2 tabular-nums">
                                    {phone.number ? (
                                      formatPhoneDisplay(phone.number)
                                    ) : (
                                      <span className="text-muted-foreground">
                                        —{s.mobile_norm ? ` (mobile: ${formatPhoneDisplay(s.mobile_norm)})` : ""}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-1">
                                    {s.export_label ? (
                                      <Badge variant="outline" className="text-[10px]">
                                        {s.export_label}
                                      </Badge>
                                    ) : s.amount !== null ? (
                                      <span className="text-muted-foreground tabular-nums">
                                        Rs. {s.amount.toLocaleString("en-LK")}
                                      </span>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {group.students.length > 4 && (
                          <p className="text-muted-foreground mt-1 text-[11px]">
                            + {group.students.length - 4} more students in {group.detectedName || "this class"}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {conflictReason && (
                <div className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg p-3 text-xs">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{conflictReason}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || !batchId || !parsed || selectedEntries.length === 0 || Boolean(conflictReason)}
            onClick={runImport}
          >
            {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            Import {selectedEntries.reduce((n, e) => n + e.group.students.length, 0)} students
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
