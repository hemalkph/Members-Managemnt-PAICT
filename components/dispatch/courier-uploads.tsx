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

import { useT } from "@/components/dispatch/lang";
import { plural } from "@/lib/dispatch/i18n";
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
const ORDER: TrackingStatus[] = [
  "conflict",
  "used",
  "unknown",
  "duplicate",
  "invalid",
  "missing",
  "voided",
  "new",
  "same",
];

async function uploadTo(path: string, file: File, contentType: string) {
  const { error } = await createClient().storage.from("dispatch").upload(path, file, { contentType, upsert: false });
  if (error) throw new Error("The upload failed. Check your connection and try again.");
}

/** Upload the processed Citypak sheet, check it against the manifest, then add the tracking numbers. */
export function TrackingImport({ roundId }: { roundId: string }) {
  const t = useT();
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
      if (!ext) return void toast.error(t("Upload the Citypak sheet as .xlsx or .csv."));
      if (file.size > MAX) return void toast.error(t("The file is larger than 15 MB."));
      const path = `rounds/${roundId}/${crypto.randomUUID()}.${ext}`;
      try {
        await uploadTo(
          path,
          file,
          ext === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      } catch (e) {
        return void toast.error(t((e as Error).message));
      }
      const result = await startTrackingImportAction({ round_id: roundId, path, file_name: file.name });
      if (!result.ok) return void toast.error(t(result.error));
      setPreview(result.data!);
      setChecked(false);
    });

  const apply = () =>
    startTransition(async () => {
      if (!preview) return;
      const result = await applyTrackingAction({ round_id: roundId, file_id: preview.fileId });
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
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
          <Input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="sm:max-w-sm"
            aria-label={t("Citypak sheet")}
          />
          <Button onClick={read} disabled={!file || pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} {t("Upload and check")}
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
                <p className="text-muted-foreground text-xs">{t(label as string)}</p>
              </div>
            ))}
          </div>

          {preview.blocking > 0 ? (
            <p className="text-destructive flex gap-2 text-sm">
              <XCircleIcon className="mt-0.5 size-4 shrink-0" />{" "}
              {t("Nothing can be added until the problems below are fixed in the file (or with Citypak).")}
            </p>
          ) : (
            <p className="text-success flex gap-2 text-sm">
              <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" /> {t("The file matches this round's manifest.")}
            </p>
          )}
          {preview.notInFile.length > 0 && (
            <p className="text-muted-foreground text-sm">
              {t("Not in this file yet:")} {preview.notInFile.slice(0, 12).join(", ")}
              {preview.notInFile.length > 12 ? ` ${t("+{n} more", { n: preview.notInFile.length - 12 })}` : ""}
            </p>
          )}

          <div className="max-h-[50vh] overflow-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-background sticky top-0">
                <TableRow>
                  <TableHead className="pl-4">{t("Reference")}</TableHead>
                  <TableHead>{t("Tracking")}</TableHead>
                  <TableHead>{t("Result")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("Differences (not changed)")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.line}-${r.reference}`}>
                    <TableCell className="pl-4 font-mono text-sm">{r.reference || "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{r.trackingNo || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS[r.status].variant} title={t(r.message)}>
                        {t(STATUS[r.status].label)}
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
                {t(
                  plural(
                    withDifferences,
                    "I checked the {n} difference. Only tracking numbers are added; names, addresses and COD in our records stay as they are.",
                    "I checked the {n} differences. Only tracking numbers are added; names, addresses and COD in our records stay as they are.",
                  ),
                  { n: withDifferences },
                )}
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPreview(null)} disabled={pending}>
              {t("Choose another file")}
            </Button>
            <Button
              onClick={apply}
              disabled={
                pending || preview.blocking > 0 || preview.counts.new === 0 || (withDifferences > 0 && !checked)
              }
            >
              {pending && <Loader2Icon className="animate-spin" />}{" "}
              {t(plural(preview.counts.new, "Add {n} tracking number", "Add {n} tracking numbers"), {
                n: preview.counts.new,
              })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Store Citypak's official waybill PDF privately and cross-check its labels. */
export function WaybillUpload({ roundId }: { roundId: string }) {
  const t = useT();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<WaybillSummary | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = () =>
    startTransition(async () => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".pdf")) return void toast.error(t("Upload the waybills as a PDF."));
      if (file.size > MAX) return void toast.error(t("The file is larger than 15 MB."));
      const path = `rounds/${roundId}/${crypto.randomUUID()}.pdf`;
      try {
        await uploadTo(path, file, "application/pdf");
      } catch (e) {
        return void toast.error(t((e as Error).message));
      }
      const result = await recordWaybillAction({ round_id: roundId, path, file_name: file.name });
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
      setSummary(result.data!);
      setFile(null);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="sm:max-w-sm"
          aria-label={t("Waybill PDF")}
        />
        <Button onClick={upload} disabled={!file || pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} {t("Upload PDF")}
        </Button>
      </div>
      {summary && (
        <div className="rounded-lg border p-3 text-sm">
          <p className="font-medium">
            {t("{labels} labels on {pages} pages · {matched} match our records", {
              labels: summary.labels,
              pages: summary.pages,
              matched: summary.matched,
            })}
          </p>
          {summary.mismatched + summary.unknown + summary.missingLabels > 0 ? (
            <div className="mt-1 space-y-0.5 text-amber-700 dark:text-warning">
              {summary.mismatched > 0 && (
                <p>
                  {t("{mismatched} label(s) don't match our tracking/reference pairs", {
                    mismatched: summary.mismatched,
                  })}
                </p>
              )}
              {summary.unknown > 0 && (
                <p>{t("{unknown} label(s) aren't in this round", { unknown: summary.unknown })}</p>
              )}
              {summary.missingLabels > 0 && (
                <p>
                  {t("{missingLabels} registered parcel(s) have no label in this PDF", {
                    missingLabels: summary.missingLabels,
                  })}
                </p>
              )}
              {summary.examples.map((e) => (
                <p key={e} className="text-xs">
                  {t(e)}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-success mt-1">{t("Every label matches.")}</p>
          )}
        </div>
      )}
    </div>
  );
}
