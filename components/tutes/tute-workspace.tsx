"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlarmClockIcon,
  BookCopyIcon,
  ClipboardCheckIcon,
  EllipsisVerticalIcon,
  FileCheckIcon,
  HandIcon,
  PackageXIcon,
  PencilIcon,
  PlusIcon,
  PrinterIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { classNeed, PrintPlan, printReason } from "@/components/tutes/print-plan";
import { StatCard } from "@/components/stat-card";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  countTuteAction,
  createPrintJobAction,
  issueTuteAction,
  receivePrintJobAction,
  savePrinterAction,
  saveTuteSettingsAction,
  setPrintJobStatusAction,
} from "@/lib/actions/tutes";
import type { ActionResult } from "@/lib/core/action-result";
import { formatDate, formatDateTime } from "@/lib/core/format";
import { monthLabel, shiftMonth, todayISO } from "@/lib/core/month";
import type { TuteMoveKind, TuteStockRow, TuteStockStatus } from "@/lib/supabase/database.types";
import type { TuteForecastCheck, TuteMove, TutePrinter, TutePrintJob } from "@/lib/tutes/queries";

export type TuteTab = "stock" | "plan" | "jobs" | "history";

const STATUS: Record<TuteStockStatus, { label: string; variant: "destructive" | "warning" | "success" | "outline" }> = {
  out: { label: "Out", variant: "destructive" },
  low: { label: "Low", variant: "warning" },
  ok: { label: "OK", variant: "success" },
  not_scheduled: { label: "Not scheduled", variant: "outline" },
};
const STATUS_ORDER: TuteStockStatus[] = ["out", "low", "ok", "not_scheduled"];

const KIND: Record<TuteMoveKind, string> = {
  opening_stock: "Opening stock",
  print_in: "Printed",
  class_issue: "Given to class",
  post_out: "Posted",
  return_in: "Returned",
  damaged: "Damaged",
  count_fix: "Count fix",
};

const JOB_STATUS = {
  planned: { label: "Planned", variant: "outline" },
  printing: { label: "Printing", variant: "warning" },
  received: { label: "Received", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
} as const;

type DialogState =
  | { kind: "count" | "issue" | "damaged" | "settings"; row: TuteStockRow }
  | { kind: "job"; row: TuteStockRow | null }
  | { kind: "receive"; job: TutePrintJob }
  | { kind: "printer"; printer: TutePrinter | null };

const leftThisMonth = (r: TuteStockRow) => Math.max(r.need_this - r.given_this, 0);

function needTitle(r: TuteStockRow): string {
  if (r.classes.length === 0) return "Not scheduled for any class this month";
  return r.classes.map((c) => `${classNeed(c)}: ${c.given} given`).join("\n");
}

export function TuteWorkspace({
  stock,
  jobs,
  printers,
  moves,
  report,
  reserved,
  month,
  tab: initialTab,
  canEdit,
}: {
  stock: TuteStockRow[];
  jobs: TutePrintJob[];
  printers: TutePrinter[];
  moves: TuteMove[];
  report: TuteForecastCheck[];
  reserved: Record<string, number>;
  month: string;
  tab: TuteTab;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TuteTab>(initialTab);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [cancelJob, setCancelJob] = useState<TutePrintJob | null>(null);
  const [pending, startTransition] = useTransition();

  const today = todayISO();
  const rows = stock
    .filter((r) => r.is_active || r.on_hand !== 0)
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name));
  const openJobs = jobs.filter((j) => j.status === "planned" || j.status === "printing");
  const lateJobs = openJobs.filter((j) => j.dueDate && j.dueDate < today);
  const printerName = new Map(printers.map((p) => [p.id, p.name]));

  const changeTab = (value: string) => {
    setTab(value as TuteTab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(null, "", url);
  };

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
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

  const receiveFor = (r: TuteStockRow) => openJobs.find((j) => j.tuteId === r.tute_id);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Out of stock" value={rows.filter((r) => r.status === "out").length} icon={PackageXIcon} tone="warning" />
        <StatCard label="Running low" value={rows.filter((r) => r.status === "low").length} icon={TriangleAlertIcon} tone="warning" delay={0.05} />
        <StatCard label="Copies printing" value={rows.reduce((s, r) => s + r.in_print, 0)} icon={PrinterIcon} tone="info" delay={0.1} />
        <StatCard label="Print jobs late" value={lateJobs.length} icon={AlarmClockIcon} delay={0.15} />
      </div>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="plan">
            Print plan
            {rows.some((r) => r.print_now > 0) && (
              <span className="text-muted-foreground ml-1 tabular-nums">{rows.filter((r) => r.print_now > 0).length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="jobs">
            Print jobs{openJobs.length > 0 && <span className="text-muted-foreground ml-1 tabular-nums">{openJobs.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------ Stock */}
        <TabsContent value="stock" className="mt-3">
          {rows.length === 0 ? (
            <EmptyState
              icon={BookCopyIcon}
              title="No tutes in this batch yet"
              description="Add tutes on Fee reminders → Tutes. They show up here with their stock."
            />
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tute</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Printing</TableHead>
                    <TableHead className="text-right">{monthLabel(month, "short")}: still to give</TableHead>
                    <TableHead className="text-right">{monthLabel(shiftMonth(month, 1), "short")}: needed</TableHead>
                    <TableHead>Status</TableHead>
                    {canEdit && <TableHead className="w-0" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.tute_id} className={r.status === "not_scheduled" ? "text-muted-foreground" : undefined}>
                      <TableCell className="max-w-72">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium break-words">{r.name}</span>
                          {r.code && (
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {r.code}
                            </Badge>
                          )}
                          {r.paper_ready && r.on_hand === 0 && r.in_print === 0 && (
                            <Badge variant="secondary" className="gap-1 text-[10px]" title="The PDF is in the Paper Library">
                              <FileCheckIcon className="size-3" /> PDF ready
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {r.on_hand}
                        {reserved[r.tute_id] > 0 && (
                          <span className="text-muted-foreground block text-xs font-normal">{reserved[r.tute_id]} held for post</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.in_print || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums" title={needTitle(r)}>
                        {r.need_this > 0 ? (
                          <>
                            {leftThisMonth(r)} <span className="text-muted-foreground text-xs">of {r.need_this}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.need_next || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "issue", row: r })}>
                              <HandIcon /> Give out
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "count", row: r })}>
                              <ClipboardCheckIcon /> Count
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost" className="size-8" aria-label={`More for ${r.name}`}>
                                  <EllipsisVerticalIcon />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {receiveFor(r) && (
                                  <DropdownMenuItem onSelect={() => setDialog({ kind: "receive", job: receiveFor(r)! })}>
                                    Received printed copies
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onSelect={() => setDialog({ kind: "job", row: r })}>New print job</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setDialog({ kind: "damaged", row: r })}>Mark damaged</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setDialog({ kind: "settings", row: r })}>Settings</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          <p className="text-muted-foreground mt-2 text-xs">
            Needed = students who paid that month, or the forecast while its paid list isn&apos;t in yet (whichever is
            higher). Hover a number to see each class.
          </p>
        </TabsContent>

        {/* ------------------------------------------------------- Print plan */}
        <TabsContent value="plan" className="mt-3">
          <PrintPlan
            rows={rows}
            report={report}
            month={month}
            canEdit={canEdit}
            onCreateJob={(r) => setDialog({ kind: "job", row: r })}
          />
        </TabsContent>

        {/* ------------------------------------------------------- Print jobs */}
        <TabsContent value="jobs" className="mt-3 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-base">Print jobs</CardTitle>
                <CardDescription>Copies arrive into stock when you mark them received. Part deliveries are fine.</CardDescription>
              </div>
              {canEdit && rows.length > 0 && (
                <Button size="sm" onClick={() => setDialog({ kind: "job", row: null })}>
                  <PlusIcon /> New print job
                </Button>
              )}
            </CardHeader>
            <CardContent className="px-0">
              {jobs.length === 0 ? (
                <p className="text-muted-foreground px-6 text-sm">No print jobs yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Tute</TableHead>
                      <TableHead className="text-right">Copies</TableHead>
                      <TableHead>Printer</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Status</TableHead>
                      {canEdit && <TableHead className="w-0" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((j) => {
                      const open = j.status === "planned" || j.status === "printing";
                      const late = open && j.dueDate !== null && j.dueDate < today;
                      return (
                        <TableRow key={j.id} className={open ? undefined : "text-muted-foreground"}>
                          <TableCell className="pl-6">
                            <span className="font-medium">{j.tuteName}</span>
                            {j.note && <p className="text-muted-foreground text-xs">{j.note}</p>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {j.receivedQty > 0 && j.receivedQty !== j.qty ? `${j.receivedQty} / ${j.qty}` : j.qty}
                          </TableCell>
                          <TableCell>{(j.printerId && printerName.get(j.printerId)) || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatDate(j.dueDate)}
                            {late && (
                              <Badge variant="destructive" className="ml-1.5">
                                Late
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={JOB_STATUS[j.status].variant}>{JOB_STATUS[j.status].label}</Badge>
                          </TableCell>
                          {canEdit && (
                            <TableCell>
                              {open && (
                                <div className="flex items-center justify-end gap-1">
                                  <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "receive", job: j })}>
                                    Received
                                  </Button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button size="icon" variant="ghost" className="size-8" aria-label="More">
                                        <EllipsisVerticalIcon />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      {j.status === "planned" && (
                                        <DropdownMenuItem
                                          onSelect={() => run(() => setPrintJobStatusAction({ id: j.id, status: "printing" }))}
                                        >
                                          Printing started
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem variant="destructive" onSelect={() => setCancelJob(j)}>
                                        Cancel job
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-base">Printers</CardTitle>
                <CardDescription>How long each one usually takes decides when the &ldquo;not ready&rdquo; alert comes.</CardDescription>
              </div>
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "printer", printer: null })}>
                  <PlusIcon /> Add printer
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {printers.length === 0 ? (
                <p className="text-muted-foreground text-sm">No printers yet.</p>
              ) : (
                <ul className="divide-y">
                  {printers.map((p) => {
                    const done = jobs.filter((j) => j.printerId === p.id && j.receivedAt);
                    const avg =
                      done.length > 0
                        ? Math.round(
                            done.reduce((s, j) => s + (Date.parse(j.receivedAt!) - Date.parse(j.createdAt)), 0) /
                              done.length /
                              86_400_000,
                          )
                        : null;
                    return (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {p.name}
                            {!p.isActive && <span className="text-muted-foreground font-normal"> · not used</span>}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            Usually {p.usualDays} days
                            {avg !== null && ` · last ${done.length} took ${avg} days on average`}
                            {p.phone && ` · ${p.phone}`}
                          </p>
                        </div>
                        {canEdit && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            aria-label={`Edit ${p.name}`}
                            onClick={() => setDialog({ kind: "printer", printer: p })}
                          >
                            <PencilIcon />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------- History */}
        <TabsContent value="history" className="mt-3">
          {moves.length === 0 ? (
            <EmptyState icon={BookCopyIcon} title="No stock changes yet" description="Count a tute to start its stock." />
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Tute</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {moves.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(m.createdAt)}</TableCell>
                      <TableCell className="font-medium">{m.tuteName}</TableCell>
                      <TableCell className={`text-right font-semibold tabular-nums ${m.qty > 0 ? "text-success" : ""}`}>
                        {m.qty > 0 ? `+${m.qty}` : m.qty}
                      </TableCell>
                      <TableCell>
                        {KIND[m.kind]}
                        {m.className && <span className="text-muted-foreground"> · {m.className}</span>}
                        {m.kind === "class_issue" && m.month && (
                          <span className="text-muted-foreground"> · {monthLabel(m.month.slice(0, 7), "short")}</span>
                        )}
                        {m.note && <p className="text-muted-foreground text-xs">{m.note}</p>}
                        {m.flag && (
                          <p className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-warning">
                            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" /> {m.flag}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>{m.by}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {dialog && (
        <TuteDialog
          state={dialog}
          rows={rows}
          printers={printers.filter((p) => p.isActive)}
          month={month}
          pending={pending}
          onClose={() => setDialog(null)}
          run={run}
        />
      )}

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
              onClick={() => cancelJob && run(() => setPrintJobStatusAction({ id: cancelJob.id, status: "cancelled" }), () => setCancelJob(null))}
            >
              Cancel job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One dialog for every stock action
// ---------------------------------------------------------------------------
function NumberField({ name, label, defaultValue, min = 0, hint }: { name: string; label: string; defaultValue?: number | string; min?: number; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`tute-${name}`}>{label}</Label>
      <Input id={`tute-${name}`} name={name} type="number" inputMode="numeric" min={min} defaultValue={defaultValue} />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

function NoteField() {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="tute-note">Note (optional)</Label>
      <Input id="tute-note" name="note" maxLength={300} />
    </div>
  );
}

function TuteDialog({
  state,
  rows,
  printers,
  month,
  pending,
  onClose,
  run,
}: {
  state: DialogState;
  rows: TuteStockRow[];
  printers: TutePrinter[];
  month: string;
  pending: boolean;
  onClose: () => void;
  run: (fn: () => Promise<ActionResult>) => void;
}) {
  const row = "row" in state ? state.row : null;
  const firstClass = row?.classes.find((c) => c.expected > c.given) ?? row?.classes[0];
  const [classId, setClassId] = useState(firstClass?.id ?? "");
  const [issueQty, setIssueQty] = useState(firstClass ? Math.max(firstClass.expected - firstClass.given, 0) || "" : "");
  const [jobTute, setJobTute] = useState(row?.tute_id ?? rows[0]?.tute_id ?? "");
  const [printerId, setPrinterId] = useState("none");
  const jobRow = rows.find((r) => r.tute_id === jobTute);

  const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
  const num = (f: FormData, k: string) => (text(f, k) === "" ? null : Number(text(f, k)));

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    switch (state.kind) {
      case "count":
        return run(() => countTuteAction({ tute_id: state.row.tute_id, counted: num(f, "counted") ?? -1, note: text(f, "note") }));
      case "issue":
      case "damaged":
        return run(() =>
          issueTuteAction({
            tute_id: state.row.tute_id,
            qty: num(f, "qty") ?? 0,
            kind: state.kind === "issue" ? "class_issue" : "damaged",
            class_id: state.kind === "issue" ? classId || null : null,
            month,
            note: text(f, "note"),
          }),
        );
      case "settings":
        return run(() =>
          saveTuteSettingsAction({
            tute_id: state.row.tute_id,
            pages: num(f, "pages"),
            reorder_level: num(f, "reorder_level"),
            print_batch: num(f, "print_batch") ?? 1,
          }),
        );
      case "job":
        return run(() =>
          createPrintJobAction({
            tute_id: jobTute,
            qty: num(f, "qty") ?? 0,
            printer_id: printerId === "none" ? null : printerId,
            due_date: text(f, "due_date") || null,
            cost: num(f, "cost"),
            note: text(f, "note"),
          }),
        );
      case "receive":
        return run(() => receivePrintJobAction({ id: state.job.id, qty: num(f, "qty") ?? 0 }));
      case "printer":
        return run(() =>
          savePrinterAction({
            id: state.printer?.id,
            name: text(f, "name"),
            phone: text(f, "phone"),
            notes: text(f, "notes"),
            usual_days: num(f, "usual_days") ?? 7,
            is_active: state.printer ? f.get("is_active") === "on" : true,
          }),
        );
    }
  };

  const title = {
    count: `Count ${row?.name ?? ""}`,
    issue: `Give out ${row?.name ?? ""}`,
    damaged: `Damaged copies of ${row?.name ?? ""}`,
    settings: `Settings for ${row?.name ?? ""}`,
    job: "New print job",
    receive: "Printed copies received",
    printer: state.kind === "printer" && state.printer ? "Edit printer" : "Add printer",
  }[state.kind];

  const suggestion = jobRow?.print_now ?? 0;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {state.kind === "count" && (
            <DialogDescription>
              Count the copies on the shelf. The difference from {state.row.on_hand} is saved as a count fix (a tute&apos;s first
              count is its opening stock).
            </DialogDescription>
          )}
          {state.kind === "receive" && (
            <DialogDescription>
              {state.job.tuteName}: {state.job.receivedQty} of {state.job.qty} received so far.
            </DialogDescription>
          )}
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {state.kind === "count" && <NumberField name="counted" label="Copies on the shelf" defaultValue={state.row.on_hand} />}

          {state.kind === "issue" &&
            (state.row.classes.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                This tute isn&apos;t scheduled for any class in {monthLabel(month)}. Schedule it on Fee reminders → Tutes first.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Class</Label>
                  <Select
                    value={classId}
                    onValueChange={(id) => {
                      setClassId(id);
                      const c = state.row.classes.find((x) => x.id === id);
                      if (c) setIssueQty(Math.max(c.expected - c.given, 0) || "");
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pick a class" />
                    </SelectTrigger>
                    <SelectContent>
                      {state.row.classes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} · {c.given} of {c.expected} given
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tute-qty">Copies given</Label>
                  <Input
                    id="tute-qty"
                    name="qty"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={issueQty}
                    onChange={(e) => setIssueQty(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                  <p className="text-muted-foreground text-xs">
                    {state.row.on_hand} on hand · counts toward {monthLabel(month)}
                  </p>
                </div>
                <NoteField />
              </>
            ))}

          {state.kind === "damaged" && (
            <>
              <NumberField name="qty" label="Damaged copies" min={1} hint={`${state.row.on_hand} on hand`} />
              <NoteField />
            </>
          )}

          {state.kind === "settings" && (
            <>
              <NumberField name="pages" label="Pages" min={1} defaultValue={state.row.pages ?? ""} />
              <NumberField
                name="print_batch"
                label="Print in batches of"
                min={1}
                defaultValue={state.row.print_batch}
                hint="Suggested print numbers are rounded up to this (e.g. 25)."
              />
              <NumberField
                name="reorder_level"
                label="Always keep at least (optional)"
                defaultValue={state.row.reorder_level ?? ""}
                hint="Leave empty to warn only when this month and next aren't covered."
              />
            </>
          )}

          {state.kind === "job" && (
            <>
              {!state.row && (
                <div className="space-y-1.5">
                  <Label>Tute</Label>
                  <Select value={jobTute} onValueChange={setJobTute}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pick a tute" />
                    </SelectTrigger>
                    <SelectContent>
                      {rows.map((r) => (
                        <SelectItem key={r.tute_id} value={r.tute_id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <NumberField
                key={jobTute}
                name="qty"
                label="Copies"
                min={1}
                defaultValue={suggestion || ""}
                hint={
                  jobRow && suggestion > 0
                    ? `Suggested: ${printReason(jobRow, month)}.`
                    : "This month and next are already covered, with spare copies."
                }
              />
              <div className="space-y-1.5">
                <Label>Printer</Label>
                <Select value={printerId} onValueChange={setPrinterId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not decided</SelectItem>
                    {printers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · usually {p.usualDays} days
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tute-due">Due (optional)</Label>
                  <Input id="tute-due" name="due_date" type="date" />
                </div>
                <NumberField name="cost" label="Cost Rs. (optional)" />
              </div>
              <NoteField />
            </>
          )}

          {state.kind === "receive" && (
            <NumberField
              name="qty"
              label="Copies that arrived"
              min={1}
              defaultValue={Math.max(state.job.qty - state.job.receivedQty, 1)}
            />
          )}

          {state.kind === "printer" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tute-name">Name</Label>
                <Input id="tute-name" name="name" maxLength={100} defaultValue={state.printer?.name} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tute-phone">Phone (optional)</Label>
                  <Input id="tute-phone" name="phone" type="tel" defaultValue={state.printer?.phone} />
                </div>
                <NumberField name="usual_days" label="Usual days to print" min={1} defaultValue={state.printer?.usualDays ?? 7} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tute-notes">Notes (optional)</Label>
                <Input id="tute-notes" name="notes" maxLength={300} defaultValue={state.printer?.notes} />
              </div>
              {state.printer && (
                <div className="flex items-center gap-2">
                  <Switch id="tute-active" name="is_active" defaultChecked={state.printer.isActive} />
                  <Label htmlFor="tute-active">Still used</Label>
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            {!(state.kind === "issue" && state.row.classes.length === 0) && (
              <Button type="submit" disabled={pending}>
                Save
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
