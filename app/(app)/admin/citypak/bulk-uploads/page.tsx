import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileSpreadsheetIcon,
  PlugZapIcon,
  PrinterIcon,
  UploadCloudIcon,
} from "lucide-react";
import { CitypakRunStatus } from "@/components/dispatch/citypak-run-status";
import { CitypakSyncButton } from "@/components/dispatch/citypak-sync-button";
import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canPrint } from "@/lib/citypak/bulk-uploads";
import { BULK_STATUS, isMissingCitypakTables } from "@/lib/citypak/labels";
import { chooseProvider } from "@/lib/citypak/provider";
import { loadRunStatus } from "@/lib/citypak/runs";
import { requireDispatch } from "@/lib/dispatch/access";
import { getT } from "@/lib/dispatch/i18n/server";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Citypak – Tute dispatch" };

const PER_PAGE = 25;

export default async function CitypakPage({ searchParams }: PageProps<"/admin/citypak/bulk-uploads">) {
  const t = await getT();
  const { caps } = await requireDispatch(["courier", "plan"]);
  const canAct = caps.has("courier");
  const choice = chooseProvider();
  const sp = await searchParams;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(String(sp.page ?? "1"), 10) || 1));

  const header = (actions?: React.ReactNode) => (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("Bulk uploads")}</h2>
        <p className="text-muted-foreground text-sm">{t("Batches uploaded to Citypak, with their Excel and waybills.")}</p>
      </div>
      {actions}
    </div>
  );

  if (!choice.ok) {
    return (
      <div className="space-y-6">
        {header()}
        <EmptyState
          icon={PlugZapIcon}
          title={t("Citypak connection is not available yet")}
          description={
            choice.reason === "live_not_ready"
              ? t("Live access stays off until Citypak authorises it and the credentials are set on the server.")
              : t("The Citypak connection is switched off on this server.")
          }
        />
      </div>
    );
  }

  const { provider } = choice;
  const demo = provider.mode === "fixture";
  const supabase = await createClient();
  const [{ data: rows, count, error }, { last, lastComplete }] = await Promise.all([
    supabase
      .from("citypak_bulk_uploads")
      .select("id, external_id, batch_reference, file_name, status, waybills, external_created_at", { count: "exact" })
      .eq("account", provider.account)
      .eq("mode", provider.mode)
      .order("external_created_at", { ascending: false, nullsFirst: false })
      .order("external_id", { ascending: false })
      .range((page - 1) * PER_PAGE, page * PER_PAGE - 1),
    loadRunStatus(supabase, provider.account, "bulk_uploads"),
  ]);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const pageHref = (p: number) => (p === 1 ? "/admin/citypak/bulk-uploads" : `/admin/citypak/bulk-uploads?page=${p}`);
  // A page past the end: PostgREST refuses the range (PGRST103) or returns nothing.
  if (page > 1 && (error?.code === "PGRST103" || (!error && page > pages))) redirect(pageHref(error ? 1 : pages));
  // Never hide a load error: log its code (no data) and say what it means.
  if (error) console.error("citypak bulk uploads: load failed", { code: error.code });
  const missingTables = isMissingCitypakTables(error);
  const list = rows ?? [];

  return (
    <div className="space-y-6">
      {header(canAct ? <CitypakSyncButton demo={demo} /> : undefined)}


      {error && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("Couldn't load the bulk uploads")}</AlertTitle>
          <AlertDescription>
            {missingTables
              ? t("The Citypak tables aren't in the database yet. An admin needs to apply migrations 028 and 029.")
              : t("Reload the page. If it keeps happening, tell an admin.")}{" "}
            <span className="font-mono text-xs">({error.code})</span>
          </AlertDescription>
        </Alert>
      )}

      <CitypakRunStatus
        t={t}
        last={last}
        lastComplete={lastComplete}
        savedNote="The batches it read are saved; sync again to complete the list."
      />

      {!error && list.length === 0 ? (
        <EmptyState
          icon={UploadCloudIcon}
          title={t("No bulk uploads yet")}
          description={canAct ? t("Press Sync to fetch them.") : t("Someone with the Courier permission can sync them.")}
        />
      ) : (
        list.length > 0 && (
          <Card className="overflow-hidden py-0 shadow-xs">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-4">{t("Batch")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("Uploaded")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  <TableHead className="text-right">{t("Waybills")}</TableHead>
                  {canAct && (
                    <TableHead className="pr-4 text-right">
                      <span className="sr-only">{t("Documents")}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((b) => {
                  const st = BULK_STATUS[b.status] ?? { label: b.status, variant: "outline" as const };
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="py-3 pl-4">
                        <Link
                          href={`/admin/citypak/bulk-uploads/${b.id}`}
                          className="font-mono text-sm font-medium underline-offset-4 hover:underline"
                        >
                          {b.batch_reference || `#${b.external_id}`}
                        </Link>
                        <p className="text-muted-foreground max-w-[260px] truncate text-xs">{b.file_name || "—"}</p>
                        <p className="text-muted-foreground text-xs sm:hidden">
                          {b.external_created_at ? formatDateTime(b.external_created_at) : "—"}
                        </p>
                      </TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">
                        {b.external_created_at ? formatDateTime(b.external_created_at) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={st.variant}>{t(st.label)}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.waybills}</TableCell>
                      {canAct && (
                        <TableCell className="pr-4">
                          <div className="flex justify-end gap-1">
                            <Button asChild variant="ghost" size="icon-sm">
                              <a href={`/admin/citypak/bulk-uploads/${b.id}/excel`} aria-label={t("Download Excel")} title={t("Download Excel")}>
                                <FileSpreadsheetIcon />
                              </a>
                            </Button>
                            {canPrint(b) ? (
                              <Button asChild variant="ghost" size="icon-sm">
                                <a
                                  href={`/admin/citypak/bulk-uploads/${b.id}/waybills?size=4X6`}
                                  target="_blank"
                                  rel="noopener"
                                  aria-label={t("Print waybills (4×6)")}
                                  title={t("Print waybills (4×6)")}
                                >
                                  <PrinterIcon />
                                </a>
                              </Button>
                            ) : (
                              <Button variant="ghost" size="icon-sm" disabled aria-label={t("No waybills to print")} title={t("No waybills to print")}>
                                <PrinterIcon />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )
      )}

      {pages > 1 && (
        <nav aria-label={t("Pages")} className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm tabular-nums">
            {t("Page {page} of {pages} · {total} batches", { page, pages, total })}
          </p>
          <div className="flex gap-2">
            <Button asChild={page > 1} variant="outline" size="sm" disabled={page <= 1}>
              {page > 1 ? (
                <Link href={pageHref(page - 1)}>
                  <ChevronLeftIcon /> {t("Previous")}
                </Link>
              ) : (
                <span>
                  <ChevronLeftIcon /> {t("Previous")}
                </span>
              )}
            </Button>
            <Button asChild={page < pages} variant="outline" size="sm" disabled={page >= pages}>
              {page < pages ? (
                <Link href={pageHref(page + 1)}>
                  {t("Next")} <ChevronRightIcon />
                </Link>
              ) : (
                <span>
                  {t("Next")} <ChevronRightIcon />
                </span>
              )}
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
