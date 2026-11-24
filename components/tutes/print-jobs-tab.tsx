"use client";

import { useMemo, useState } from "react";
import {
  EllipsisVerticalIcon,
  MessageCircleIcon,
  PackageCheckIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
} from "lucide-react";
import { JOB_STATUS, type DialogState } from "@/components/tutes/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatLKR } from "@/lib/core/format";
import { normalizeWaPhone } from "@/lib/fees/phone";
import { feeWhatsAppUrl } from "@/lib/fees/templates";
import type { TutePrinter, TutePrintJob } from "@/lib/tutes/queries";
import { cn } from "@/lib/utils";

type JobFilter = "open" | "received" | "cancelled" | "all";

export function PrintJobsTab({
  jobs,
  printers,
  printerName,
  hasTutes,
  today,
  canEdit,
  onOpenDialog,
  onMarkPrinting,
  onCancelJob,
}: {
  jobs: TutePrintJob[];
  printers: TutePrinter[];
  printerName: Map<string, string>;
  hasTutes: boolean;
  today: string;
  canEdit: boolean;
  onOpenDialog: (state: DialogState) => void;
  onMarkPrinting: (job: TutePrintJob) => void;
  onCancelJob: (job: TutePrintJob) => void;
}) {
  const openCount = useMemo(() => jobs.filter((j) => j.status === "planned" || j.status === "printing").length, [jobs]);
  const receivedCount = useMemo(() => jobs.filter((j) => j.status === "received").length, [jobs]);
  const cancelledCount = useMemo(() => jobs.filter((j) => j.status === "cancelled").length, [jobs]);

  const [filter, setFilter] = useState<JobFilter>(openCount > 0 ? "open" : "all");

  const visibleJobs = useMemo(() => {
    if (filter === "all") return jobs;
    if (filter === "open") return jobs.filter((j) => j.status === "planned" || j.status === "printing");
    return jobs.filter((j) => j.status === filter);
  }, [jobs, filter]);

  const totalCost = useMemo(
    () => visibleJobs.reduce((sum, j) => sum + (j.cost ?? 0), 0),
    [visibleJobs],
  );
  const hasAnyCost = visibleJobs.some((j) => j.cost !== null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Print jobs</CardTitle>
            <CardDescription>Copies arrive into stock when you mark them received. Part deliveries are fine.</CardDescription>
          </div>
          {canEdit && hasTutes && (
            <Button size="sm" onClick={() => onOpenDialog({ kind: "job", row: null })}>
              <PlusIcon /> New print job
            </Button>
          )}
        </CardHeader>

        {jobs.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-6 pb-3">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { key: "open", label: "Open", count: openCount },
                  { key: "received", label: "Received", count: receivedCount },
                  { key: "cancelled", label: "Cancelled", count: cancelledCount },
                  { key: "all", label: "All", count: jobs.length },
                ] as const
              ).map((f) => (
                <Button
                  key={f.key}
                  type="button"
                  size="sm"
                  variant={filter === f.key ? "default" : "outline"}
                  className="h-7 gap-1 px-2.5 text-xs"
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className={cn("tabular-nums", filter === f.key ? "opacity-80" : "text-muted-foreground")}>
                    {f.count}
                  </span>
                </Button>
              ))}
            </div>
            {hasAnyCost && (
              <Badge variant="outline" className="font-normal tabular-nums">
                Total cost: <span className="ml-1 font-medium">{formatLKR(totalCost)}</span>
              </Badge>
            )}
          </div>
        )}

        <CardContent className="px-0">
          {jobs.length === 0 ? (
            <p className="text-muted-foreground px-6 text-sm">No print jobs yet.</p>
          ) : visibleJobs.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-2 text-sm">
              <p className="text-muted-foreground">No {filter} print jobs.</p>
              <Button size="sm" variant="outline" onClick={() => setFilter("all")}>
                Show all ({jobs.length})
              </Button>
            </div>
          ) : (
            <>
              {/* Desktop print jobs table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Tute</TableHead>
                      <TableHead className="text-right">Copies</TableHead>
                      <TableHead>Printer</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead>Status</TableHead>
                      {canEdit && <TableHead className="w-0" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleJobs.map((j) => {
                      const open = j.status === "planned" || j.status === "printing";
                      const late = open && j.dueDate !== null && j.dueDate < today;
                      const partial = j.receivedQty > 0 && j.receivedQty < j.qty;
                      const pct = j.qty > 0 ? Math.min(100, Math.round((j.receivedQty / j.qty) * 100)) : 0;
                      return (
                        <TableRow key={j.id} className={open ? undefined : "text-muted-foreground"}>
                          <TableCell className="pl-6">
                            <span className="font-medium">{j.tuteName}</span>
                            {j.note && <p className="text-muted-foreground text-xs">{j.note}</p>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {partial ? (
                              <div className="inline-flex flex-col items-end gap-1">
                                <span>
                                  {j.receivedQty} / {j.qty}
                                </span>
                                <Progress value={pct} className="h-1.5 w-20" aria-label={`${pct}% received`} />
                              </div>
                            ) : (
                              j.qty
                            )}
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
                          <TableCell className="text-right whitespace-nowrap tabular-nums">
                            {j.cost !== null ? formatLKR(j.cost) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={JOB_STATUS[j.status].variant}>{JOB_STATUS[j.status].label}</Badge>
                          </TableCell>
                          {canEdit && (
                            <TableCell>
                              {open && (
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => onOpenDialog({ kind: "receive", jobs: [j], initialJobId: j.id })}
                                  >
                                    Received
                                  </Button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button size="icon" variant="ghost" className="size-8" aria-label="More">
                                        <EllipsisVerticalIcon />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "edit_job", job: j })}>
                                        Edit job
                                      </DropdownMenuItem>
                                      {j.status === "planned" && (
                                        <DropdownMenuItem onSelect={() => onMarkPrinting(j)}>
                                          Printing started
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem variant="destructive" onSelect={() => onCancelJob(j)}>
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
              </div>

              {/* Mobile print job cards */}
              <div className="divide-y px-4 md:hidden">
                {visibleJobs.map((j) => {
                  const open = j.status === "planned" || j.status === "printing";
                  const late = open && j.dueDate !== null && j.dueDate < today;
                  const partial = j.receivedQty > 0 && j.receivedQty < j.qty;
                  const pct = j.qty > 0 ? Math.min(100, Math.round((j.receivedQty / j.qty) * 100)) : 0;
                  return (
                    <div key={j.id} className={cn("space-y-2 py-3 first:pt-0 last:pb-0", !open && "text-muted-foreground")}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium break-words">{j.tuteName}</p>
                          <p className="text-muted-foreground text-xs">
                            {partial ? `${j.receivedQty} / ${j.qty}` : j.qty} copies
                            {j.printerId && printerName.get(j.printerId) ? ` · ${printerName.get(j.printerId)}` : ""}
                            {j.dueDate ? ` · due ${formatDate(j.dueDate)}` : ""}
                            {j.cost !== null ? ` · ${formatLKR(j.cost)}` : ""}
                          </p>
                          {j.note && <p className="text-muted-foreground mt-0.5 text-xs">{j.note}</p>}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {late && <Badge variant="destructive">Late</Badge>}
                          <Badge variant={JOB_STATUS[j.status].variant}>{JOB_STATUS[j.status].label}</Badge>
                        </div>
                      </div>

                      {partial && <Progress value={pct} className="h-1.5" aria-label={`${pct}% received`} />}

                      {canEdit && open && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => onOpenDialog({ kind: "receive", jobs: [j], initialJobId: j.id })}
                          >
                            <PackageCheckIcon /> Received
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onOpenDialog({ kind: "edit_job", job: j })}
                          >
                            Edit
                          </Button>
                          {j.status === "planned" && (
                            <Button size="sm" variant="ghost" onClick={() => onMarkPrinting(j)}>
                              Started
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onCancelJob(j)}>
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Printers card with 1-tap Call & WhatsApp */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">Printers</CardTitle>
            <CardDescription>How long each one usually takes decides when the &ldquo;not ready&rdquo; alert comes.</CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => onOpenDialog({ kind: "printer", printer: null })}>
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
                const wa = normalizeWaPhone(p.phone);
                const telHref = p.phone ? `tel:${p.phone.replace(/[^+\d]/g, "")}` : null;
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
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
                      {p.notes && <p className="text-muted-foreground text-xs">{p.notes}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {telHref && (
                        <Button asChild size="icon" variant="ghost" className="size-8" aria-label={`Call ${p.name}`}>
                          <a href={telHref}>
                            <PhoneIcon className="size-4" />
                          </a>
                        </Button>
                      )}
                      {wa && (
                        <Button asChild size="icon" variant="ghost" className="size-8" aria-label={`WhatsApp ${p.name}`}>
                          <a href={feeWhatsAppUrl(wa, `Hi ${p.name}, checking in on our PAICT tute print order.`)} target="_blank" rel="noreferrer">
                            <MessageCircleIcon className="size-4" />
                          </a>
                        </Button>
                      )}
                      {canEdit && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={`Edit ${p.name}`}
                          onClick={() => onOpenDialog({ kind: "printer", printer: p })}
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
