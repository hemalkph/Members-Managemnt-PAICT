"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { CountAllDialog, HandOutDialog } from "@/components/tutes/bulk-stock-dialogs";
import { HistoryTab, type HistoryKindFilter } from "@/components/tutes/history-tab";
import { PrintJobsTab } from "@/components/tutes/print-jobs-tab";
import { PrintPlan } from "@/components/tutes/print-plan";
import {
  STATUS_ORDER,
  type ClassOption,
  type DialogState,
  type PaperOption,
  type StockFilter,
  type TuteTab,
} from "@/components/tutes/shared";
import { ShelfRibbon } from "@/components/tutes/shelf-ribbon";
import { StockTab } from "@/components/tutes/stock-tab";
import { TuteDialog } from "@/components/tutes/tute-dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  countTuteAction,
  deleteTuteAction,
  saveTuteAction,
  setPrintJobStatusAction,
  setTuteCoverAction,
} from "@/lib/actions/tutes";
import type { ActionResult } from "@/lib/core/action-result";
import { shiftMonth, todayISO } from "@/lib/core/month";
import type { TuteSaveInput } from "@/lib/core/validation";
import type { TuteStockRow } from "@/lib/supabase/database.types";
import { uploadTuteCover } from "@/lib/tutes/cover-image";
import type { TuteForecastCheck, TuteMove, TutePrinter, TutePrintJob } from "@/lib/tutes/queries";

export type { TuteTab } from "@/components/tutes/shared";

export function TuteWorkspace({
  stock,
  jobs,
  printers,
  moves,
  report,
  reserved,
  coverUrls,
  pace,
  papers,
  classes,
  month,
  tab: initialTab,
  canEdit,
  canSchedule,
  orderTuteId,
}: {
  stock: TuteStockRow[];
  jobs: TutePrintJob[];
  printers: TutePrinter[];
  moves: TuteMove[];
  report: TuteForecastCheck[];
  reserved: Record<string, number>;
  coverUrls: Record<string, string>;
  pace: { samples: number; needed: number };
  papers: PaperOption[];
  classes: ClassOption[];
  month: string;
  tab: TuteTab;
  canEdit: boolean;
  canSchedule: boolean;
  orderTuteId: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TuteTab>(initialTab);
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [localCovers, setLocalCovers] = useState<Record<string, string | null>>({});
  const [uploadingCoverId, setUploadingCoverId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(() => {
    if (!canEdit || !orderTuteId) return null;
    const match = stock.find((r) => r.tute_id === orderTuteId);
    return match ? { kind: "job", row: match } : null;
  });
  const [bulk, setBulk] = useState<"count" | "handout" | null>(null);
  const [cancelJob, setCancelJob] = useState<TutePrintJob | null>(null);
  const [deleting, setDeleting] = useState<TuteStockRow | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // History filters (lifted so inspecting a booklet can jump straight into its History)
  const [historySearch, setHistorySearch] = useState("");
  const [historyTute, setHistoryTute] = useState("all");
  const [historyKind, setHistoryKind] = useState<HistoryKindFilter>("all");

  const [pending, startTransition] = useTransition();

  // Strip one-shot ?order= param from the URL so refreshing doesn't re-open the print job dialog.
  useEffect(() => {
    if (!orderTuteId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("order")) {
      url.searchParams.delete("order");
      window.history.replaceState(null, "", url);
    }
  }, [orderTuteId]);

  const today = todayISO();
  const nextMonth = shiftMonth(month, 1);
  const archived = stock.filter((r) => !r.is_active && r.on_hand === 0).length;
  const rows = useMemo(
    () =>
      stock
        .filter((r) => showArchived || r.is_active || r.on_hand !== 0)
        .sort(
          (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name),
        ),
    [stock, showArchived],
  );
  const activeRows = useMemo(() => rows.filter((r) => r.is_active), [rows]);

  const openJobs = useMemo(() => jobs.filter((j) => j.status === "planned" || j.status === "printing"), [jobs]);
  const lateJobs = useMemo(() => openJobs.filter((j) => j.dueDate && j.dueDate < today), [openJobs, today]);
  const printerName = useMemo(() => new Map(printers.map((p) => [p.id, p.name])), [printers]);

  const openJobsByTute = useMemo(() => {
    const map = new Map<string, TutePrintJob[]>();
    for (const j of openJobs) {
      map.set(j.tuteId, [...(map.get(j.tuteId) ?? []), j]);
    }
    return map;
  }, [openJobs]);

  const tutesWithHistory = useMemo(() => new Set(moves.map((m) => m.tuteId)), [moves]);

  const changeTab = (value: string) => {
    setTab(value as TuteTab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(null, "", url);
  };

  const handleRibbonFilter = (next: StockFilter) => {
    setStockFilter(next);
    if (tab !== "stock") changeTab("stock");
  };

  const openHistoryFor = (tuteId: string) => {
    setHistoryTute(tuteId);
    setHistoryKind("all");
    setHistorySearch("");
    changeTab("history");
  };

  const openReceiveForTute = (tuteId: string) => {
    const tuteJobs = openJobsByTute.get(tuteId) ?? [];
    if (tuteJobs.length === 0) return;
    setDialog({ kind: "receive", jobs: tuteJobs, initialJobId: tuteJobs[0].id });
  };

  const run = (fn: () => Promise<ActionResult<unknown>>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setDialog(null);
      after?.();
      router.refresh();
    });

  const handleSaveNewTute = (input: TuteSaveInput, coverFile: File | null) =>
    startTransition(async () => {
      const res = await saveTuteAction(input);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      const newId = res.data?.id;
      if (coverFile && newId) {
        const previewUrl = URL.createObjectURL(coverFile);
        const up = await uploadTuteCover(newId, coverFile);
        if (!up.ok) {
          URL.revokeObjectURL(previewUrl);
          toast.warning(`${res.message ?? "Tute added"} — cover upload failed (${up.error})`);
        } else {
          const coverRes = await setTuteCoverAction({ tute_id: newId, path: up.path });
          if (!coverRes.ok) {
            URL.revokeObjectURL(previewUrl);
            toast.warning(`${res.message ?? "Tute added"} — could not attach cover (${coverRes.error})`);
          } else {
            setLocalCovers((prev) => ({ ...prev, [newId]: previewUrl }));
            toast.success(`${res.message ?? "Tute added"} · cover uploaded`);
          }
        }
      } else {
        toast.success(res.message);
      }

      setDialog(null);
      router.refresh();
    });

  const runBulk = (fn: () => Promise<ActionResult>) => run(fn, () => setBulk(null));

  const handleInlineCount = (tuteId: string, counted: number) =>
    run(() => countTuteAction({ tute_id: tuteId, counted, note: "" }));

  const effectiveCoverUrls = useMemo<Record<string, string | null>>(
    () => ({ ...coverUrls, ...localCovers }),
    [coverUrls, localCovers],
  );

  const handleUploadCover = (tuteId: string, file: File) => {
    setUploadingCoverId(tuteId);
    const previewUrl = URL.createObjectURL(file);
    startTransition(async () => {
      try {
        const up = await uploadTuteCover(tuteId, file);
        if (!up.ok) {
          URL.revokeObjectURL(previewUrl);
          toast.error(up.error);
          return;
        }
        const res = await setTuteCoverAction({ tute_id: tuteId, path: up.path });
        if (!res.ok) {
          URL.revokeObjectURL(previewUrl);
          toast.error(res.error);
          return;
        }
        setLocalCovers((prev) => ({ ...prev, [tuteId]: previewUrl }));
        toast.success(res.message);
        router.refresh();
      } finally {
        setUploadingCoverId(null);
      }
    });
  };

  const handleRemoveCover = (tuteId: string) => {
    setUploadingCoverId(tuteId);
    startTransition(async () => {
      try {
        const res = await setTuteCoverAction({ tute_id: tuteId, path: null });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setLocalCovers((prev) => ({ ...prev, [tuteId]: null }));
        toast.success(res.message);
        router.refresh();
      } finally {
        setUploadingCoverId(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      <ShelfRibbon
        rows={rows}
        lateJobsCount={lateJobs.length}
        month={month}
        activeFilter={tab === "stock" ? stockFilter : "all"}
        onSelectFilter={handleRibbonFilter}
        onOpenLateJobs={() => changeTab("jobs")}
      />

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="plan">
            Print plan
            {rows.some((r) => r.print_now > 0) && (
              <span className="text-muted-foreground ml-1 tabular-nums">
                {rows.filter((r) => r.print_now > 0).length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="jobs">
            Print jobs
            {openJobs.length > 0 && <span className="text-muted-foreground ml-1 tabular-nums">{openJobs.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-3">
          <StockTab
            rows={rows}
            moves={moves}
            coverUrls={effectiveCoverUrls}
            archivedCount={archived}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((v) => !v)}
            filter={stockFilter}
            onFilterChange={setStockFilter}
            openJobsByTute={openJobsByTute}
            reserved={reserved}
            month={month}
            nextMonth={nextMonth}
            canEdit={canEdit}
            pending={pending}
            uploadingCoverId={uploadingCoverId}
            onInlineCount={handleInlineCount}
            onUploadCover={handleUploadCover}
            onRemoveCover={handleRemoveCover}
            onOpenDialog={setDialog}
            onOpenBulk={setBulk}
            onOpenReceive={openReceiveForTute}
            onOpenHistory={openHistoryFor}
            onDelete={setDeleting}
          />
        </TabsContent>

        <TabsContent value="plan" className="mt-3">
          <PrintPlan
            rows={rows}
            report={report}
            pace={pace}
            month={month}
            canEdit={canEdit}
            onCreateJob={(r, suggestedQty) => setDialog({ kind: "job", row: r, suggestedQty })}
          />
        </TabsContent>

        <TabsContent value="jobs" className="mt-3">
          <PrintJobsTab
            jobs={jobs}
            printers={printers}
            printerName={printerName}
            hasTutes={rows.length > 0}
            today={today}
            canEdit={canEdit}
            onOpenDialog={setDialog}
            onMarkPrinting={(j) => run(() => setPrintJobStatusAction({ id: j.id, status: "printing" }))}
            onCancelJob={setCancelJob}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          <HistoryTab
            moves={moves}
            stock={stock}
            month={month}
            search={historySearch}
            onSearchChange={setHistorySearch}
            tuteFilter={historyTute}
            onTuteFilterChange={setHistoryTute}
            kindFilter={historyKind}
            onKindFilterChange={setHistoryKind}
            onClearFilters={() => {
              setHistorySearch("");
              setHistoryTute("all");
              setHistoryKind("all");
            }}
          />
        </TabsContent>
      </Tabs>

      {bulk === "count" && (
        <CountAllDialog rows={activeRows} pending={pending} run={runBulk} onClose={() => setBulk(null)} />
      )}
      {bulk === "handout" && (
        <HandOutDialog
          rows={activeRows}
          reserved={reserved}
          month={month}
          pending={pending}
          run={runBulk}
          onClose={() => setBulk(null)}
        />
      )}
      {dialog && (
        <TuteDialog
          state={dialog}
          rows={rows}
          jobs={jobs}
          tutesWithHistory={tutesWithHistory}
          reserved={reserved}
          coverUrls={effectiveCoverUrls}
          printers={printers.filter((p) => p.isActive)}
          allPrinters={printers}
          papers={papers}
          classes={classes}
          canSchedule={canSchedule}
          month={month}
          pending={pending}
          uploadingCoverId={uploadingCoverId}
          onSaveNewTute={handleSaveNewTute}
          onUploadCover={handleUploadCover}
          onRemoveCover={handleRemoveCover}
          onClose={() => setDialog(null)}
          run={run}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deleting?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from every class and month. A tute that already has stock, print or post history can&apos;t
              be deleted: edit it and untick &ldquo;In use&rdquo; to archive it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deleting &&
                run(
                  () => deleteTuteAction(deleting.tute_id),
                  () => setDeleting(null),
                )
              }
            >
              Delete tute
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelJob !== null} onOpenChange={(v) => !v && setCancelJob(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this print job?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelJob && cancelJob.receivedQty > 0
                ? `The ${cancelJob.receivedQty} copies already received stay in stock. No more copies are expected.`
                : "No copies are expected from it any more."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                cancelJob &&
                run(
                  () => setPrintJobStatusAction({ id: cancelJob.id, status: "cancelled" }),
                  () => setCancelJob(null),
                )
              }
            >
              Cancel job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
