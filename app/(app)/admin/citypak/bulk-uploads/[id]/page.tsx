import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, FileSpreadsheetIcon, FlaskConicalIcon, InfoIcon, PrinterIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canPrint } from "@/lib/citypak/bulk-uploads";
import { BULK_STATUS } from "@/lib/citypak/labels";
import { chooseProvider } from "@/lib/citypak/provider";
import { requireDispatch } from "@/lib/dispatch/access";
import { getT } from "@/lib/dispatch/i18n/server";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Citypak bulk upload – Tute dispatch" };

export default async function CitypakBatchPage({ params }: PageProps<"/admin/citypak/bulk-uploads/[id]">) {
  const t = await getT();
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { caps } = await requireDispatch(["courier", "plan"]);
  const supabase = await createClient();
  const { data: b, error } = await supabase.from("citypak_bulk_uploads").select("*").eq("id", id).maybeSingle();
  // A load error is not "not found": surface it (code only, no data).
  if (error) throw new Error(`Citypak batch could not be loaded (${error.code})`);
  if (!b) notFound();
  const choice = chooseProvider();
  const areaMode = choice.ok ? choice.provider.mode : "off";
  const st = BULK_STATUS[b.status] ?? { label: b.status, variant: "outline" as const };
  const when = (v: string | null) => (v ? formatDateTime(v) : "—");

  const facts: [string, React.ReactNode][] = [
    [t("Batch reference"), <span key="r" className="font-mono">{b.batch_reference || "—"}</span>],
    [t("Citypak batch ID"), <span key="i" className="font-mono">{b.external_id}</span>],
    [t("File name"), b.file_name || "—"],
    [t("Status"), <Badge key="s" variant={st.variant}>{t(st.label)}</Badge>],
    [t("Waybills"), <span key="w" className="tabular-nums">{b.waybills}</span>],
    [t("Upload started"), when(b.started_at)],
    [t("Upload finished"), when(b.ended_at)],
    [t("Created at Citypak"), when(b.external_created_at)],
    [t("First synced"), when(b.first_seen_at)],
    [t("Last seen in a sync"), when(b.last_seen_at)],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="font-mono text-xl font-semibold tracking-tight">{b.batch_reference || `#${b.external_id}`}</h2>}
        description={t("Citypak bulk upload")}
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/citypak/bulk-uploads">
              <ArrowLeftIcon /> {t("All bulk uploads")}
            </Link>
          </Button>
        }
      />

      {/* The area banner covers demo mode; this marks a demo row seen outside it. */}
      {b.mode === "fixture" && areaMode !== "fixture" && (
        <Alert>
          <FlaskConicalIcon />
          <AlertTitle>{t("Demo data")}</AlertTitle>
          <AlertDescription>{t("This batch and its documents are made-up fixture data, not from Citypak.")}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="py-0 shadow-xs">
          <dl className="divide-y">
            {facts.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-3 px-4 py-3 text-sm">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <div className="space-y-4">
          <Card className="gap-3 shadow-xs">
            <CardHeader>
              <CardTitle className="text-base">{t("Documents")}</CardTitle>
              <CardDescription>{t("Fetched from Citypak when you open them. Not stored here.")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {caps.has("courier") ? (
                <>
                  <Button asChild variant="outline" className="justify-start">
                    <a href={`/admin/citypak/bulk-uploads/${b.id}/excel`}>
                      <FileSpreadsheetIcon /> {t("Download Excel")}
                    </a>
                  </Button>
                  {canPrint(b) ? (
                    <Button asChild variant="outline" className="justify-start">
                      <a href={`/admin/citypak/bulk-uploads/${b.id}/waybills?size=4X6`} target="_blank" rel="noopener">
                        <PrinterIcon /> {t("Print waybills (4×6)")}
                      </a>
                    </Button>
                  ) : (
                    <Button variant="outline" className="justify-start" disabled>
                      <PrinterIcon /> {t("No waybills to print")}
                    </Button>
                  )}
                  <p className="text-muted-foreground text-xs">{t("A4 printing will be added once Citypak confirms its setting.")}</p>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">{t("Documents need the Courier permission.")}</p>
              )}
            </CardContent>
          </Card>

          <Alert>
            <InfoIcon />
            <AlertTitle>{t("Waybills in this batch")}</AlertTitle>
            <AlertDescription>
              {t(
                "Citypak's list of the waybills inside a batch isn't available yet, so they aren't shown, and this batch isn't linked to a dispatch round.",
              )}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}
