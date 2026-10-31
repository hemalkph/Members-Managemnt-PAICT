import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, DownloadIcon, FileSpreadsheetIcon, FileTextIcon, LockIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TrackingImport, WaybillUpload } from "@/components/dispatch/courier-uploads";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireDispatch } from "@/lib/dispatch/access";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Courier files – Tute dispatch" };

type WaybillSummaryJson = { labels?: number; matched?: number; mismatched?: number; unknown?: number; missingLabels?: number };

export default async function CourierPage({ params }: PageProps<"/admin/dispatch/rounds/[id]/courier">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  await requireDispatch("courier");
  const supabase = await createClient();
  const [{ data: round }, { data: files }, { data: settings }] = await Promise.all([
    supabase.from("dispatch_rounds").select("id, name, state").eq("id", id).maybeSingle(),
    supabase
      .from("carrier_files")
      .select("id, kind, file_name, row_count, summary, created_at")
      .eq("round_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("dispatch_settings").select("citypak_template_verified").limit(1).maybeSingle(),
  ]);
  if (!round) notFound();
  const open = round.state === "finalised" || round.state === "active";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Courier files"
        description={round.name}
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/dispatch/rounds/${id}`}>
              <ArrowLeftIcon /> Round
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LockIcon className="text-muted-foreground size-5" /> 1. Citypak upload file
          </CardTitle>
          <CardDescription>
            {settings?.citypak_template_verified
              ? "Citypak's template has been verified. The export will be switched on once its column mapping is approved."
              : "Switched off until Citypak's blank upload template is stored and verified in Dispatch settings, so no column value is guessed. Until then, register the parcels in the Citypak portal as you do today."}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheetIcon className="text-primary size-5" /> 2. Tracking numbers
          </CardTitle>
          <CardDescription>
            Upload the processed sheet Citypak gives back (with “Citypak Tracking” and “Your Reference”). It is matched to this
            round by reference; nothing is saved until you confirm, and names, addresses and COD are never changed.
          </CardDescription>
        </CardHeader>
        <CardContent>{open ? <TrackingImport roundId={id} /> : <p className="text-muted-foreground text-sm">This round is not open.</p>}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileTextIcon className="text-primary size-5" /> 3. Waybill PDF
          </CardTitle>
          <CardDescription>
            Store Citypak&apos;s official labels privately for printing. The labels are cross-checked against our tracking numbers;
            the sheet stays the source of truth.
          </CardDescription>
        </CardHeader>
        <CardContent>{open ? <WaybillUpload roundId={id} /> : <p className="text-muted-foreground text-sm">This round is not open.</p>}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <CardDescription>Private. Every download is recorded in the activity log.</CardDescription>
        </CardHeader>
        <CardContent>
          {files && files.length > 0 ? (
            <ul className="divide-y text-sm">
              {files.map((f) => {
                const s = (f.summary ?? {}) as WaybillSummaryJson;
                return (
                  <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{f.file_name}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatDateTime(f.created_at)} ·{" "}
                        {f.kind === "waybill_pdf" ? `${s.labels ?? 0} labels, ${s.matched ?? 0} matched` : `${f.row_count ?? 0} rows`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{f.kind === "waybill_pdf" ? "Waybills" : "Tracking sheet"}</Badge>
                      <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${f.file_name}`}>
                        <a href={`/admin/dispatch/files/${f.id}`}>
                          <DownloadIcon />
                        </a>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No files yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
