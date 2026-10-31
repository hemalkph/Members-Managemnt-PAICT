"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon, UploadIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  applyTrackingAction,
  recordWaybillAction,
  startTrackingImportAction,
  type TrackingPreview,
  type WaybillSummary,
} from "@/lib/actions/dispatch-rounds";
import type { TrackingStatus } from "@/lib/dispatch/tracking";
import { createClient } from "@/lib/supabase/client";

const MAX = 15 * 1024 * 1024;

const STATUS: Record<TrackingStatus, { label: string; variant: "success" | "outline" | "destructive" | "warning" }> = {
  new: { label: "Will be added", variant: "success" },
  same: { label: "Already has it", variant: "outline" },
  conflict: { label: "Different number", variant: "destructive" },
  used: { label: "Used elsewhere", variant: "destructive" },
  unknown: { label: "Not in round", variant: "destructive" },
  duplicate: { label: "Duplicate", variant: "destructive" },
  missing: { label: "No number", variant: "warning" },
  invalid: { label: "Looks wrong", variant: "destructive" },
  voided: { label: "Voided", variant: "warning" },
};
const ORDER: TrackingStatus[] = ["conflict", "used", "unknown", "duplicate", "invalid", "missing", "voided", "new", "same"];

async function uploadTo(path: string, file: File, contentType: string) {
  const { error } = await createClient().storage.from("dispatch").upload(path, file, { contentType, upsert: false });
  if (error) throw new Error("The upload failed. Check your connection and try again.");
}

/** Upload the processed Citypak sheet, check it against the manifest, then add the tracking numbers. */
export function TrackingImport({ roundId }: { roundId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TrackingPreview | null>(null);
  const [checked, setChecked] = useState(false);
  const [pending, startTransition] = useTransition();

  const read = () =>
    startTransition(async () => {
      if (!file) return;
      const lower = file.name.toLowerCase();
      const ext = lower.endsWith(".xlsx") ? "xlsx" : lower.endsWith(".csv") ? "csv" : null;
      if (!ext) return void toast.error("Upload the Citypak sheet as .xlsx or .csv.");
      if (file.size > MAX) return void toast.error("The file is larger than 15 MB.");
      const path = `rounds/${roundId}/${crypto.randomUUID()}.${ext}`;
      try {
        await uploadTo(path, file, ext === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      } catch (e) {
        return void toast.error((e as Error).message);
      }
      const result = await startTrackingImportAction({ round_id: roundId, path, file_name: file.name });
      if (!result.ok) return void toast.error(result.error);
      setPreview(result.data!);
      setChecked(false);
    });

  const apply = () =>
    startTransition(async () => {
      if (!preview) return;
      const result = await applyTrackingAction({ round_id: roundId, file_id: preview.fileId });
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      setPreview(null);
      setFile(null);
      router.refresh();
    });

  const withDifferences = preview ? preview.rows.filter((r) => r.differences.length > 0).length : 0;
  const rows = preview ? [...preview.rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)) : [];

  return (
    <div className="space-y-4">
      {!preview && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sm:max-w-sm" aria-label="Citypak sheet" />
          <Button onClick={read} disabled={!file || pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Upload and check
          </Button>
        </div>
      )}

      {preview && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Will be added", preview.counts.new],
              ["Already added", preview.counts.same],
              ["Problems", preview.blocking],
              ["Not in file", preview.notInFile.length],
            ].map(([label, n]) => (
              <div key={label as string} className="rounded-lg border p-3">
                <p className="text-2xl font-semibold tabular-nums">{n}</p>
                <p className="text-muted-foreground text-xs">{label}</p>
              </div>
            ))}
          </div>

          {preview.blocking > 0 ? (
            <p className="text-destructive flex gap-2 text-sm">
              <XCircleIcon className="mt-0.5 size-4 shrink-0" /> Nothing can be added until the problems below are fixed in the file (or with Citypak).
            </p>
          ) : (
            <p className="text-success flex gap-2 text-sm">
              <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" /> The file matches this round&apos;s manifest.
            </p>
          )}
          {preview.notInFile.length > 0 && (
            <p className="text-muted-foreground text-sm">
              Not in this file yet: {preview.notInFile.slice(0, 12).join(", ")}
              {preview.notInFile.length > 12 ? ` +${preview.notInFile.length - 12} more` : ""}
            </p>
          )}

          <div className="max-h-[50vh] overflow-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-background sticky top-0">
                <TableRow>
                  <TableHead className="pl-4">Reference</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="hidden md:table-cell">Differences (not changed)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.line}-${r.reference}`}>
                    <TableCell className="pl-4 font-mono text-sm">{r.reference || "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{r.trackingNo || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS[r.status].variant} title={r.message}>
                        {STATUS[r.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-[360px] text-xs md:table-cell">
                      {r.differences.map((d) => (
                        <p key={d} className="flex gap-1 text-amber-700 dark:text-warning">
                          <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" /> {d}
                        </p>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {withDifferences > 0 && preview.blocking === 0 && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} className="mt-0.5" />
              <span>
                I checked the {withDifferences} difference{withDifferences === 1 ? "" : "s"}. Only tracking numbers are added; names,
                addresses and COD in our records stay as they are.
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPreview(null)} disabled={pending}>
              Choose another file
            </Button>
            <Button
              onClick={apply}
              disabled={pending || preview.blocking > 0 || preview.counts.new === 0 || (withDifferences > 0 && !checked)}
            >
              {pending && <Loader2Icon className="animate-spin" />} Add {preview.counts.new} tracking number{preview.counts.new === 1 ? "" : "s"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Store Citypak's official waybill PDF privately and cross-check its labels. */
export function WaybillUpload({ roundId }: { roundId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<WaybillSummary | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = () =>
    startTransition(async () => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".pdf")) return void toast.error("Upload the waybills as a PDF.");
      if (file.size > MAX) return void toast.error("The file is larger than 15 MB.");
      const path = `rounds/${roundId}/${crypto.randomUUID()}.pdf`;
      try {
        await uploadTo(path, file, "application/pdf");
      } catch (e) {
        return void toast.error((e as Error).message);
      }
      const result = await recordWaybillAction({ round_id: roundId, path, file_name: file.name });
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      setSummary(result.data!);
      setFile(null);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sm:max-w-sm" aria-label="Waybill PDF" />
        <Button onClick={upload} disabled={!file || pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Upload PDF
        </Button>
      </div>
      {summary && (
        <div className="rounded-lg border p-3 text-sm">
          <p className="font-medium">
            {summary.labels} labels on {summary.pages} pages · {summary.matched} match our records
          </p>
          {summary.mismatched + summary.unknown + summary.missingLabels > 0 ? (
            <div className="mt-1 space-y-0.5 text-amber-700 dark:text-warning">
              {summary.mismatched > 0 && <p>{summary.mismatched} label(s) don&apos;t match our tracking/reference pairs</p>}
              {summary.unknown > 0 && <p>{summary.unknown} label(s) aren&apos;t in this round</p>}
              {summary.missingLabels > 0 && <p>{summary.missingLabels} registered parcel(s) have no label in this PDF</p>}
              {summary.examples.map((e) => (
                <p key={e} className="text-xs">
                  {e}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-success mt-1">Every label matches.</p>
          )}
        </div>
      )}
    </div>
  );
}
