"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import {
  AlertTriangleIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  CopyIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  FileUpIcon,
  Loader2Icon,
  MessageCircleIcon,
  PencilIcon,
  RepeatIcon,
  SchoolIcon,
  PhoneOffIcon,
  SearchIcon,
  SparklesIcon,
  TagIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { FollowupDialog } from "@/components/fees/followup-dialog";
import { TemplateEditor } from "@/components/fees/template-editor";
import { UploadMonthDialog } from "@/components/fees/upload-month-dialog";
import { WhatsAppQueueDialog } from "@/components/fees/whatsapp-queue-dialog";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/read-only-notice";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deleteFeeMonthAction, setFeeFollowupAction } from "@/lib/actions/fees";
import { formatDateTime } from "@/lib/core/format";
import { monthLabel, shiftMonth } from "@/lib/core/month";
import { comparedRowsToCsv, type ComparedStudent, type FeeComparisonSummary } from "@/lib/fees/compare";
import { formatPhoneDisplay } from "@/lib/fees/phone";
import type { FeeClassItem, FeeTemplateItem, ScheduledMonthTute } from "@/lib/fees/queries";
import { feeWhatsAppUrl, renderFeeMessage, templateUsesTutes } from "@/lib/fees/templates";
import type { FeeFollowupStatus } from "@/lib/supabase/database.types";
import { isClosedFollowup } from "@/lib/fees/renewals";
import { cn } from "@/lib/utils";

type FilterBucket = "due_pending" | "due_new_wa" | "due_messaged" | "due_all" | "paid" | "new" | "excused_dropped";

const STATUS_META: Record<
  FeeFollowupStatus,
  { label: string; variant: "destructive" | "warning" | "secondary" | "outline" }
> = {
  pending: { label: "Due · Not messaged", variant: "destructive" },
  messaged: { label: "Due · Messaged", variant: "warning" },
  excused: { label: "Excused", variant: "secondary" },
  dropped: { label: "Left class", variant: "outline" },
  promised: { label: "Promised to pay", variant: "warning" },
  cant_afford: { label: "Can't afford", variant: "secondary" },
  moved_class: { label: "Moved class", variant: "outline" },
};

export function FeeWorkspace({
  batches,
  classes,
  templates,
  scheduledTutes,
  selectedBatchId,
  selectedClassId,
  prevMonth,
  currMonth,
  defaultUploadMonth,
  initialRows,
  initialSummary,
  canEdit,
}: {
  batches: { id: string; name: string; isActive: boolean }[];
  classes: FeeClassItem[];
  templates: FeeTemplateItem[];
  scheduledTutes: ScheduledMonthTute[];
  selectedBatchId: string;
  selectedClassId: string | null;
  prevMonth: string | null;
  currMonth: string | null;
  defaultUploadMonth: string;
  initialRows: ComparedStudent[];
  initialSummary: FeeComparisonSummary;
  canEdit: boolean;
}) {
  const router = useRouter();
  const tableCaptionId = useId();
  const [rows, setRows] = useState<ComparedStudent[]>(initialRows);
  const [prevInitialRows, setPrevInitialRows] = useState(initialRows);
  if (initialRows !== prevInitialRows) {
    setPrevInitialRows(initialRows);
    setRows(initialRows);
  }

  const [activeTab, setActiveTab] = useState("compare");
  const [bucket, setBucket] = useState<FilterBucket>("due_all");
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState("__all__");
  const [instituteFilter, setInstituteFilter] = useState("__all__");
  const [hideFreeCard, setHideFreeCard] = useState(false);

  const defaultTemplateId = templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? "";
  const [activeTemplateId, setActiveTemplateId] = useState(defaultTemplateId);
  const [queueOpen, setQueueOpen] = useState(false);
  const [editingFollowup, setEditingFollowup] = useState<ComparedStudent | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pendingDeleteMonth, startDeleteMonth] = useTransition();

  const batchClasses = useMemo(() => classes.filter((c) => c.batchId === selectedBatchId), [classes, selectedBatchId]);
  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );
  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === activeTemplateId) ?? templates[0] ?? null,
    [templates, activeTemplateId],
  );

  // Recompute live counts from local rows so instant updates reflect immediately in KPIs & filter chips.
  const counts = useMemo(() => {
    let duePending = 0;
    let dueNewWa = 0;
    let dueMessaged = 0;
    let dueExcusedDropped = 0;
    let paid = 0;
    let fresh = 0;
    for (const r of rows) {
      if (r.kind === "due") {
        if (r.followupStatus === "pending") duePending++;
        else if (r.followupStatus === "messaged" || r.followupStatus === "promised") {
          dueMessaged++;
          if (r.contactPhoneChanged) dueNewWa++;
        } else dueExcusedDropped++;
      } else if (r.kind === "paid") paid++;
      else fresh++;
    }
    return {
      duePending,
      dueNewWa,
      dueMessaged,
      dueActive: duePending + dueMessaged,
      dueAll: duePending + dueMessaged + dueExcusedDropped,
      dueExcusedDropped,
      paid,
      fresh,
    };
  }, [rows]);

  const distinctLabels = useMemo(() => [...new Set(rows.map((r) => r.primaryLabel).filter(Boolean))].sort(), [rows]);

  const navigate = (
    params: { batch?: string; classId?: string | null; prev?: string | null; curr?: string | null },
    options?: { refresh?: boolean },
  ) => {
    const q = new URLSearchParams();
    const b = params.batch ?? selectedBatchId;
    const c = params.classId !== undefined ? params.classId : selectedClassId;
    const p = params.prev !== undefined ? params.prev : prevMonth;
    const cur = params.curr !== undefined ? params.curr : currMonth;
    if (b) q.set("batch", b);
    if (c) q.set("class", c);
    if (cur) q.set("curr", cur);
    if (p) q.set("prev", p);
    const nextUrl = `/admin/fee-reminders?${q.toString()}`;
    router.push(nextUrl);
    if (options?.refresh) router.refresh();
  };

  /**
   * After uploading a month, keep chronological order:
   * - If the uploaded month is newer than (or equal to) existing months, open it as currMonth.
   * - If the uploaded month is older than the class's latest month, keep latest as currMonth and uploaded as prevMonth.
   */
  const handleMonthImported = ({ batchId, classId, month }: { batchId: string; classId: string; month: string }) => {
    const targetClass = classes.find((c) => c.id === classId);
    const latestExisting = targetClass?.months[0]?.month ?? null;
    if (latestExisting && month < latestExisting) {
      navigate({ batch: batchId, classId, curr: latestExisting, prev: month }, { refresh: true });
    } else {
      navigate({ batch: batchId, classId, curr: month, prev: null }, { refresh: true });
    }
  };

  const patchRowLocal = (patch: {
    studentKey: string;
    status: FeeFollowupStatus;
    label?: string;
    note?: string;
    messageCount?: number;
    lastMessagedAt?: string | null;
  }) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.studentKey !== patch.studentKey) return r;
        const customLabel = patch.label !== undefined ? patch.label : r.customLabel;
        const primaryLabel =
          customLabel ||
          r.exportLabel ||
          (r.concessionCard ? `${r.concessionCard[0].toUpperCase()}${r.concessionCard.slice(1)} card` : "") ||
          r.inferredFeeLabel ||
          "";
        return {
          ...r,
          followupStatus: patch.status,
          customLabel,
          primaryLabel,
          contactPhoneChanged:
            patch.status === "messaged" && patch.messageCount !== undefined ? false : r.contactPhoneChanged,
          previousMessagedPhone:
            patch.status === "messaged" && patch.messageCount !== undefined ? null : r.previousMessagedPhone,
          note: patch.note !== undefined ? patch.note : r.note,
          messageCount: patch.messageCount !== undefined ? patch.messageCount : r.messageCount,
          lastMessagedAt: patch.lastMessagedAt !== undefined ? patch.lastMessagedAt : r.lastMessagedAt,
        };
      }),
    );
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (bucket === "due_pending" && !(r.kind === "due" && r.followupStatus === "pending")) return false;
      if (bucket === "due_new_wa" && !(r.kind === "due" && r.contactPhoneChanged)) return false;
      if (
        bucket === "due_messaged" &&
        !(r.kind === "due" && (r.followupStatus === "messaged" || r.followupStatus === "promised"))
      )
        return false;
      if (bucket === "due_all" && r.kind !== "due") return false;
      if (bucket === "excused_dropped" && !(r.kind === "due" && isClosedFollowup(r.followupStatus))) return false;
      if (bucket === "paid" && r.kind !== "paid") return false;
      if (bucket === "new" && r.kind !== "new") return false;

      if (hideFreeCard && /free/i.test(r.primaryLabel)) return false;
      if (labelFilter === "__unlabeled__" && r.primaryLabel !== "") return false;
      if (labelFilter !== "__all__" && labelFilter !== "__unlabeled__" && r.primaryLabel !== labelFilter) return false;
      if (instituteFilter !== "__all__" && r.institute !== instituteFilter) return false;

      if (q) {
        const hay =
          `${r.fullName} ${r.email} ${r.currentEmail ?? ""} ${r.contactPhone ?? ""} ${r.mobileNorm ?? ""} ${r.primaryLabel} ${r.district} ${r.note}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, bucket, search, hideFreeCard, labelFilter, instituteFilter]);

  const currMonthLabelStr = currMonth ? monthLabel(currMonth) : "Current Month";
  const prevMonthLabelStr = prevMonth ? monthLabel(prevMonth) : "Previous Month";
  const activeClassName = selectedClass?.name ?? "Class";

  const activeTuteMonth = currMonth ?? defaultUploadMonth;
  const currMonthTutes = useMemo(
    () =>
      scheduledTutes
        .filter((t) => t.month === activeTuteMonth)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => t.tuteName),
    [scheduledTutes, activeTuteMonth],
  );
  const nextMonthTutes = useMemo(() => {
    const nextKey = shiftMonth(activeTuteMonth, 1);
    return scheduledTutes
      .filter((t) => t.month === nextKey)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => t.tuteName);
  }, [scheduledTutes, activeTuteMonth]);

  const missingTutesForTemplate = Boolean(
    activeTemplate && templateUsesTutes(activeTemplate.body) && currMonthTutes.length === 0,
  );

  const renderMessageForStudent = (s: ComparedStudent) => {
    if (!activeTemplate) return "";
    return renderFeeMessage(activeTemplate.body, {
      fullName: s.fullName,
      className: activeClassName,
      monthLabel: currMonthLabelStr,
      prevMonthLabel: prevMonthLabelStr,
      amount: s.prevAmount ?? s.currAmount,
      institute: s.institute,
      label: s.primaryLabel,
      tutes: currMonthTutes,
      nextMonthTutes,
    });
  };

  const sendWhatsAppOne = async (s: ComparedStudent) => {
    if (!s.contactPhone || !selectedClass || !currMonth) return;
    const msg = renderMessageForStudent(s);
    window.open(feeWhatsAppUrl(s.contactPhone, msg), "_blank", "noopener,noreferrer");

    if (!canEdit || s.kind !== "due") return;
    setBusyKey(s.studentKey);
    const res = await setFeeFollowupAction({
      class_id: selectedClass.id,
      due_month: currMonth,
      student_key: s.studentKey,
      student_name: s.fullName,
      email_norm: s.emailNorm,
      whatsapp_norm: s.contactPhone,
      status: "messaged",
      template_id: activeTemplate?.id ?? null,
      increment_message: true,
    });
    setBusyKey(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    patchRowLocal({
      studentKey: s.studentKey,
      status: "messaged",
      messageCount: res.data?.messageCount,
      lastMessagedAt: res.data?.lastMessagedAt,
    });
  };

  const copyMessageForStudent = async (s: ComparedStudent) => {
    try {
      await navigator.clipboard.writeText(renderMessageForStudent(s));
      toast.success(`Copied message for ${s.fullName}`);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  const downloadCsv = () => {
    const csv = comparedRowsToCsv(filteredRows, activeClassName, currMonthLabelStr);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeClassName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${currMonth ?? "due"}-fees.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const removeMonthImport = (monthKey: string) => {
    if (!selectedClass) return;
    startDeleteMonth(async () => {
      const res = await deleteFeeMonthAction({ class_id: selectedClass.id, month: monthKey });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  };

  // Sample student context for the live WhatsApp preview in TemplateEditor.
  const sampleStudent = rows.find((r) => r.kind === "due") ?? rows[0] ?? null;
  const sampleContext = {
    fullName: sampleStudent?.fullName ?? "Ayodya Karunasena",
    className: activeClassName,
    monthLabel: currMonthLabelStr,
    prevMonthLabel: prevMonthLabelStr,
    amount: sampleStudent?.prevAmount ?? sampleStudent?.currAmount ?? 3000,
    institute: sampleStudent?.institute || "Online",
    label: sampleStudent?.primaryLabel || "",
    tutes: currMonthTutes.length > 0 ? currMonthTutes : ["Unit 07 - Database Systems", "SQL Practice Pack"],
    nextMonthTutes: nextMonthTutes.length > 0 ? nextMonthTutes : ["Unit 08 - Computer Networks"],
  };

  const hasBothMonths = Boolean(
    selectedClass &&
    prevMonth &&
    currMonth &&
    selectedClass.months.some((m) => m.month === prevMonth) &&
    selectedClass.months.some((m) => m.month === currMonth),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fee reminders"
        description="Compare previous and current month paid lists class-by-class, automatically flag due students, and send customizable WhatsApp reminders with emojis."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/fee-reminders/renewals">
                <RepeatIcon /> Renewals
              </Link>
            </Button>
            {canEdit && batches.length > 0 ? (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/class-ops">
                    <SchoolIcon /> Manage classes
                  </Link>
                </Button>
                <UploadMonthDialog
                  batches={batches}
                  classes={classes}
                  defaultBatchId={selectedBatchId}
                  activeClassId={selectedClassId}
                  defaultMonth={defaultUploadMonth}
                  onImported={handleMonthImported}
                />
              </>
            ) : null}
          </>
        }
      />

      {!canEdit && <ReadOnlyNotice />}

      {batches.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheetIcon}
          title="No batches yet"
          description="Create at least one A/L batch in Batches & exams before tracking monthly class fees."
        />
      ) : (
        <>
          {/* Batch -> Class -> Month selector card */}
          <Card>
            <CardContent className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <label htmlFor="sel-batch" className="text-muted-foreground text-xs font-medium">
                  Batch
                </label>
                <Select
                  value={selectedBatchId}
                  onValueChange={(bid) => {
                    const firstClass = classes.find((c) => c.batchId === bid)?.id ?? null;
                    navigate({ batch: bid, classId: firstClass, prev: null, curr: null });
                  }}
                >
                  <SelectTrigger id="sel-batch">
                    <SelectValue placeholder="Choose batch" />
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

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="sel-class" className="text-muted-foreground text-xs font-medium">
                    Class ({batchClasses.length} in batch)
                  </label>
                  <Link
                    href="/admin/class-ops"
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px]"
                  >
                    <PencilIcon className="size-3" /> Classes
                  </Link>
                </div>
                <Select
                  value={selectedClassId ?? ""}
                  disabled={batchClasses.length === 0}
                  onValueChange={(cid) => navigate({ classId: cid, prev: null, curr: null })}
                >
                  <SelectTrigger id="sel-class">
                    <SelectValue placeholder={batchClasses.length === 0 ? "No classes yet" : "Choose class"} />
                  </SelectTrigger>
                  <SelectContent>
                    {batchClasses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.months.length} mo)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label htmlFor="sel-prev" className="text-muted-foreground text-xs font-medium">
                  Previous month (paid baseline)
                </label>
                <Select
                  value={prevMonth ?? ""}
                  disabled={!selectedClass || selectedClass.months.length === 0}
                  onValueChange={(m) => navigate({ prev: m })}
                >
                  <SelectTrigger id="sel-prev">
                    <SelectValue placeholder="Upload a month first" />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedClass?.months ?? []).map((m) => (
                      <SelectItem key={m.month} value={m.month} disabled={Boolean(currMonth && m.month >= currMonth)}>
                        {monthLabel(m.month)} ({m.uniqueStudentCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label htmlFor="sel-curr" className="text-muted-foreground text-xs font-medium">
                  Current month (checking who paid)
                </label>
                <Select
                  value={currMonth ?? ""}
                  disabled={!selectedClass || selectedClass.months.length === 0}
                  onValueChange={(m) => navigate({ curr: m, prev: prevMonth && prevMonth < m ? prevMonth : null })}
                >
                  <SelectTrigger id="sel-curr">
                    <SelectValue placeholder="Upload current month" />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedClass?.months ?? []).map((m) => (
                      <SelectItem key={m.month} value={m.month}>
                        {monthLabel(m.month)} ({m.uniqueStudentCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* KPI Strip */}
          {selectedClass && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label={`Paid in ${prevMonth ? monthLabel(prevMonth, "short") : "prev"}`}
                value={initialSummary.prevCount}
                icon={UsersIcon}
                hint={prevMonth ? "Baseline student count" : "Upload previous month"}
              />
              <StatCard
                label={`Paid both (${initialSummary.retentionPct}%)`}
                value={initialSummary.paidBothCount}
                icon={CheckCircle2Icon}
                tone="success"
                hint={
                  initialSummary.phoneMatchedCount > 0
                    ? `${initialSummary.phoneMatchedCount} matched by phone · +${initialSummary.newCount} new`
                    : `+${initialSummary.newCount} new this month`
                }
                delay={0.05}
              />
              <StatCard
                label="Flagged Due"
                value={counts.dueAll}
                icon={AlertTriangleIcon}
                tone="warning"
                hint={`${counts.duePending} not messaged yet`}
                delay={0.1}
              />
              <StatCard
                label="WhatsApp Sent"
                value={counts.dueMessaged}
                icon={MessageCircleIcon}
                tone="info"
                hint={
                  counts.dueExcusedDropped > 0
                    ? `${counts.dueExcusedDropped} excused / left class`
                    : `${counts.duePending} remaining in queue`
                }
                delay={0.15}
              />
            </div>
          )}

          {/* Workspace Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList>
              <TabsTrigger value="compare">
                Due &amp; Comparison
                {counts.duePending > 0 && (
                  <Badge variant="destructive" className="ml-1 px-1.5 text-[10px]">
                    {counts.duePending}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="templates">
                <SparklesIcon className="size-3.5" /> WhatsApp Templates ({templates.length})
              </TabsTrigger>
              <TabsTrigger value="months">Uploaded Months ({selectedClass?.months.length ?? 0})</TabsTrigger>
            </TabsList>

            {/* TAB 1: Due & Comparison */}
            <TabsContent value="compare" className="space-y-4">
              {!selectedClass ? (
                <EmptyState
                  icon={FileSpreadsheetIcon}
                  title="No class uploaded for this batch yet"
                  description="Upload your previous month and current month Excel or CSV paid lists — classes are auto-detected and kept separate."
                  action={
                    canEdit ? (
                      <UploadMonthDialog
                        batches={batches}
                        classes={classes}
                        defaultBatchId={selectedBatchId}
                        activeClassId={null}
                        defaultMonth={defaultUploadMonth}
                        onImported={handleMonthImported}
                      >
                        <Button>
                          <FileUpIcon /> Upload first paid list
                        </Button>
                      </UploadMonthDialog>
                    ) : undefined
                  }
                />
              ) : !hasBothMonths ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {selectedClass.months.length === 0
                        ? `Upload two months for ${selectedClass.name}`
                        : `Upload a second month to compare ${selectedClass.name}`}
                    </CardTitle>
                    <CardDescription>
                      {selectedClass.months.length === 1
                        ? `${monthLabel(selectedClass.months[0].month)} is saved (${selectedClass.months[0].uniqueStudentCount} students). Upload the other month now to automatically flag students who haven't paid yet.`
                        : "Pick both a previous month and a current month above, or upload your Excel / CSV sheets."}
                    </CardDescription>
                  </CardHeader>
                  {canEdit && (
                    <CardContent>
                      <UploadMonthDialog
                        batches={batches}
                        classes={classes}
                        defaultBatchId={selectedBatchId}
                        activeClassId={selectedClass.id}
                        defaultMonth={defaultUploadMonth}
                        onImported={handleMonthImported}
                      />
                    </CardContent>
                  )}
                </Card>
              ) : (
                <>
                  {/* Action bar: Template selector + Guided WhatsApp Queue + Export CSV */}
                  <div className="bg-card flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground text-xs font-medium">WhatsApp message:</span>
                      <Select value={activeTemplate?.id ?? ""} onValueChange={setActiveTemplateId}>
                        <SelectTrigger className="h-8 w-[230px] text-xs">
                          <SelectValue placeholder="Choose template" />
                        </SelectTrigger>
                        <SelectContent>
                          {templates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" onClick={downloadCsv} disabled={filteredRows.length === 0}>
                        <DownloadIcon /> Export CSV ({filteredRows.length})
                      </Button>
                      <Button
                        size="sm"
                        className="bg-[#0f7a6e] text-white hover:bg-[#0c675d]"
                        disabled={counts.dueAll === 0 || !activeTemplate}
                        onClick={() => setQueueOpen(true)}
                      >
                        <MessageCircleIcon />
                        Send WhatsApp Queue ({counts.duePending + counts.dueNewWa} left)
                      </Button>
                    </div>
                  </div>

                  {/* Compact strip showing active month's scheduled tutes for {tutes} / {tutes_list} */}
                  <div
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs",
                      missingTutesForTemplate
                        ? "border-amber-500/40 bg-warning/15 text-amber-800 dark:text-amber-300"
                        : "bg-muted/30",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <BookOpenIcon className="size-3.5 shrink-0" />
                      <span className="font-medium">{currMonthLabelStr} tutes:</span>
                      {currMonthTutes.length > 0 ? (
                        currMonthTutes.map((name) => (
                          <Badge key={name} variant="secondary" className="font-normal">
                            📘 {name}
                          </Badge>
                        ))
                      ) : (
                        <span className={missingTutesForTemplate ? "" : "text-muted-foreground"}>
                          {missingTutesForTemplate
                            ? "Active template uses {tutes}, but none are added for this month yet."
                            : "None scheduled yet (optional — fills {tutes} & {tutes_list} in reminders)."}
                        </span>
                      )}
                    </div>
                    <Button asChild variant="outline" size="sm" className="h-7 px-2.5 text-xs">
                      <Link href="/admin/class-ops?tab=plan">
                        {currMonthTutes.length > 0 ? "Manage tutes" : "+ Add tutes"}
                      </Link>
                    </Button>
                  </div>

                  {/* Filter pills + search + label/institute filters */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter students by payment status">
                      {(
                        [
                          ["due_pending", `Unmessaged Due (${counts.duePending})`],
                          ...(counts.dueNewWa > 0
                            ? ([["due_new_wa", `New WhatsApp # (${counts.dueNewWa})`]] as [FilterBucket, string][])
                            : []),
                          ["due_messaged", `Messaged (${counts.dueMessaged})`],
                          ["due_all", `All Due (${counts.dueAll})`],
                          ["paid", `Paid Both (${counts.paid})`],
                          ["new", `New / Current Only (${counts.fresh})`],
                          ["excused_dropped", `Excused / Left (${counts.dueExcusedDropped})`],
                        ] as [FilterBucket, string][]
                      ).map(([k, label]) => (
                        <Button
                          key={k}
                          size="sm"
                          variant={bucket === k ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() => setBucket(k)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative min-w-[200px] flex-1">
                        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                        <Input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search name, Gmail, phone, label, district..."
                          className="h-8 pl-8 text-xs"
                        />
                      </div>

                      {distinctLabels.length > 0 && (
                        <Select value={labelFilter} onValueChange={setLabelFilter}>
                          <SelectTrigger className="h-8 w-[170px] text-xs">
                            <SelectValue placeholder="All labels" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All labels</SelectItem>
                            <SelectItem value="__unlabeled__">No label</SelectItem>
                            {distinctLabels.map((l) => (
                              <SelectItem key={l} value={l}>
                                {l}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {initialSummary.distinctInstitutes.length > 1 && (
                        <Select value={instituteFilter} onValueChange={setInstituteFilter}>
                          <SelectTrigger className="h-8 w-[160px] text-xs">
                            <SelectValue placeholder="All institutes" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All institutes</SelectItem>
                            {initialSummary.distinctInstitutes.map((inst) => (
                              <SelectItem key={inst} value={inst}>
                                {inst}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                        <Switch checked={hideFreeCard} onCheckedChange={setHideFreeCard} />
                        Hide Free card
                      </label>
                    </div>
                  </div>

                  {/* Accessible Responsive Student Table */}
                  {filteredRows.length === 0 ? (
                    <EmptyState
                      icon={CheckCircle2Icon}
                      title="No students match this filter"
                      description="Try switching status tabs or clearing your search."
                    />
                  ) : (
                    <Card className="overflow-hidden py-0">
                      <div
                        tabIndex={0}
                        role="region"
                        aria-labelledby={tableCaptionId}
                        className="fee-table-wrap focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <table className="text-sm">
                          <caption id={tableCaptionId} className="sr-only">
                            {activeClassName} fee comparison between {prevMonthLabelStr} and {currMonthLabelStr}
                          </caption>
                          <thead className="bg-muted text-muted-foreground border-b text-[11px] tracking-wide uppercase">
                            <tr>
                              <th scope="col" className="border-b px-3.5 py-2.5 text-left font-semibold">
                                Student
                              </th>
                              <th scope="col" className="border-b px-3 py-2.5 text-left font-semibold">
                                WhatsApp
                              </th>
                              <th scope="col" className="border-b px-3 py-2.5 text-left font-semibold">
                                Labels
                              </th>
                              <th scope="col" className="border-b px-3 py-2.5 text-left font-semibold">
                                Status
                              </th>
                              <th scope="col" className="border-b px-3.5 py-2.5 text-right font-semibold">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredRows.map((s) => {
                              const statusMeta = s.kind === "due" ? STATUS_META[s.followupStatus] : null;
                              return (
                                <tr
                                  key={`${s.kind}-${s.studentKey}`}
                                  className={cn(
                                    "hover:bg-muted/35 transition-colors",
                                    s.kind === "due" && s.followupStatus === "pending" && "bg-destructive/[0.025]",
                                    s.kind === "due" && isClosedFollowup(s.followupStatus) && "opacity-65",
                                  )}
                                >
                                  <th scope="row" className="border-b px-3.5 py-2.5 text-left font-normal align-top">
                                    <p className="font-medium leading-snug">{s.fullName}</p>
                                    <p className="text-muted-foreground truncate text-xs">{s.email || "—"}</p>
                                    {s.currentEmail && (
                                      <p className="text-xs text-emerald-700 dark:text-emerald-400">
                                        Phone match · new Gmail: {s.currentEmail}
                                      </p>
                                    )}
                                    {(s.institute || s.district) && (
                                      <p className="text-muted-foreground text-[11px]">
                                        {[s.institute, s.district].filter(Boolean).join(" · ")}
                                      </p>
                                    )}
                                  </th>

                                  <td
                                    style={{ "--col-label": '"WhatsApp"' } as React.CSSProperties}
                                    className="border-b px-3 py-2.5 align-top whitespace-nowrap tabular-nums"
                                  >
                                    {s.contactPhone ? (
                                      <div className="space-y-0.5">
                                        <span className="font-medium">{formatPhoneDisplay(s.contactPhone)}</span>
                                        {s.contactPhoneChanged && (
                                          <Badge
                                            variant="warning"
                                            className="block w-fit text-[10px]"
                                            title={
                                              s.previousMessagedPhone
                                                ? `Previously messaged on ${formatPhoneDisplay(s.previousMessagedPhone)}`
                                                : "Updated WhatsApp number"
                                            }
                                          >
                                            New WhatsApp #
                                          </Badge>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="space-y-0.5">
                                        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                                          <PhoneOffIcon className="size-3.5" /> No WhatsApp
                                        </span>
                                        {s.mobileNorm && (
                                          <span className="text-muted-foreground block text-[11px]">
                                            Mobile: {formatPhoneDisplay(s.mobileNorm)}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </td>

                                  <td
                                    style={{ "--col-label": '"Labels"' } as React.CSSProperties}
                                    className="border-b px-3 py-2.5 align-top"
                                  >
                                    <div className="flex flex-wrap items-center gap-1">
                                      {s.primaryLabel && <Badge variant="outline">{s.primaryLabel}</Badge>}
                                      {s.exportLabel && s.exportLabel !== s.primaryLabel && (
                                        <Badge variant="secondary">{s.exportLabel}</Badge>
                                      )}
                                      {s.prevAmount !== null && s.kind === "due" && (
                                        <span className="text-muted-foreground text-xs tabular-nums">
                                          Rs. {s.prevAmount.toLocaleString("en-LK")}
                                        </span>
                                      )}
                                      {s.currAmount !== null && s.kind !== "due" && (
                                        <span className="text-muted-foreground text-xs tabular-nums">
                                          Rs. {s.currAmount.toLocaleString("en-LK")}
                                        </span>
                                      )}
                                    </div>
                                    {s.note && (
                                      <p
                                        className="text-muted-foreground mt-1 max-w-[240px] truncate text-xs"
                                        title={s.note}
                                      >
                                        Note: {s.note}
                                      </p>
                                    )}
                                  </td>

                                  <td
                                    style={{ "--col-label": '"Status"' } as React.CSSProperties}
                                    className="border-b px-3 py-2.5 align-top"
                                  >
                                    {s.kind === "due" && statusMeta ? (
                                      <div className="space-y-1">
                                        <Badge variant={statusMeta.variant}>
                                          {statusMeta.label}
                                          {s.messageCount > 0 ? ` ×${s.messageCount}` : ""}
                                        </Badge>
                                        {s.lastMessagedAt && (
                                          <p className="text-muted-foreground text-[11px]">
                                            {formatDateTime(s.lastMessagedAt)}
                                            {s.lastMessagedByName ? ` · ${s.lastMessagedByName.split(" ")[0]}` : ""}
                                          </p>
                                        )}
                                      </div>
                                    ) : s.kind === "paid" ? (
                                      <div className="space-y-1">
                                        <Badge variant="success">Paid both months</Badge>
                                        {s.matchKind === "phone" && (
                                          <Badge variant="outline" className="block w-fit text-[10px]">
                                            Matched by phone
                                          </Badge>
                                        )}
                                        {s.matchKind === "name" && (
                                          <Badge variant="outline" className="block w-fit text-[10px]">
                                            Matched by name
                                          </Badge>
                                        )}
                                      </div>
                                    ) : (
                                      <Badge variant="secondary">
                                        {s.isNewStudent ? "New student" : "Paid this month"}
                                      </Badge>
                                    )}
                                  </td>

                                  <td
                                    style={{ "--col-label": '"Actions"' } as React.CSSProperties}
                                    className="border-b px-3.5 py-2.5 align-top text-right whitespace-nowrap"
                                  >
                                    <div className="inline-flex items-center justify-end gap-1.5">
                                      {s.kind === "due" && s.contactPhone && activeTemplate && (
                                        <Button
                                          type="button"
                                          size="sm"
                                          disabled={busyKey === s.studentKey}
                                          onClick={() => void sendWhatsAppOne(s)}
                                          className="h-7 bg-[#0f7a6e] px-2.5 text-xs text-white hover:bg-[#0c675d]"
                                        >
                                          {busyKey === s.studentKey ? (
                                            <Loader2Icon className="animate-spin" />
                                          ) : (
                                            <MessageCircleIcon />
                                          )}
                                          WhatsApp
                                        </Button>
                                      )}
                                      {s.kind === "due" && activeTemplate && (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="icon"
                                          className="size-7"
                                          title="Copy personalized message"
                                          aria-label={`Copy message for ${s.fullName}`}
                                          onClick={() => void copyMessageForStudent(s)}
                                        >
                                          <CopyIcon className="size-3.5" />
                                        </Button>
                                      )}
                                      {s.kind === "due" && canEdit && (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="icon"
                                          className="size-7"
                                          title="Edit status, label or note"
                                          aria-label={`Edit follow-up for ${s.fullName}`}
                                          onClick={() => setEditingFollowup(s)}
                                        >
                                          <TagIcon className="size-3.5" />
                                        </Button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>

            {/* TAB 3: Customizable WhatsApp Message Templates */}
            <TabsContent value="templates">
              <TemplateEditor templates={templates} sampleContext={sampleContext} canEdit={canEdit} />
            </TabsContent>

            {/* TAB 3: Uploaded Months History */}
            <TabsContent value="months">
              {!selectedClass || selectedClass.months.length === 0 ? (
                <EmptyState
                  icon={FileSpreadsheetIcon}
                  title="No uploaded months for this class yet"
                  description="Upload your Excel or CSV monthly paid exports to begin tracking."
                />
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Uploaded months — {selectedClass.name}</CardTitle>
                    <CardDescription>
                      Re-upload any ongoing month at any time — newly paid students clear from Due automatically while
                      your WhatsApp follow-up history is preserved.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {selectedClass.months.map((m) => (
                      <div
                        key={m.month}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                      >
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{monthLabel(m.month)}</span>
                            <Badge variant="secondary">{m.uniqueStudentCount} unique students</Badge>
                            {m.duplicatesMerged > 0 && (
                              <Badge variant="outline">{m.duplicatesMerged} duplicate merged</Badge>
                            )}
                          </div>
                          <p className="text-muted-foreground text-xs">
                            File: {m.fileName} · Uploaded {formatDateTime(m.uploadedAt)}
                            {m.uploadedByName ? ` by ${m.uploadedByName}` : ""}
                          </p>
                        </div>
                        {canEdit && (
                          <div className="flex items-center gap-1.5">
                            <UploadMonthDialog
                              batches={batches}
                              classes={classes}
                              defaultBatchId={selectedBatchId}
                              activeClassId={selectedClass.id}
                              defaultMonth={m.month}
                              onImported={handleMonthImported}
                            >
                              <Button variant="outline" size="sm" className="h-7 text-xs">
                                <FileUpIcon /> Re-upload
                              </Button>
                            </UploadMonthDialog>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive size-7"
                                  aria-label={`Remove ${monthLabel(m.month)} import`}
                                  disabled={pendingDeleteMonth}
                                >
                                  <Trash2Icon className="size-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove {monthLabel(m.month)} paid list?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This deletes the imported student rows for {selectedClass.name} (
                                    {monthLabel(m.month)}
                                    ). You can upload the file again any time.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => removeMonthImport(m.month)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Remove month
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Guided WhatsApp Send Queue Modal */}
      {selectedClass && currMonth && (
        <WhatsAppQueueDialog
          open={queueOpen}
          onOpenChange={setQueueOpen}
          students={rows}
          templates={templates}
          initialTemplateId={activeTemplate?.id ?? ""}
          classId={selectedClass.id}
          className={selectedClass.name}
          dueMonth={currMonth}
          dueMonthLabel={currMonthLabelStr}
          prevMonthLabel={prevMonthLabelStr}
          currMonthTutes={currMonthTutes}
          nextMonthTutes={nextMonthTutes}
          canEdit={canEdit}
          onStudentUpdated={patchRowLocal}
        />
      )}

      {/* Per-student Label / Follow-up Triage Modal */}
      {selectedClass && currMonth && (
        <FollowupDialog
          student={editingFollowup}
          classId={selectedClass.id}
          dueMonth={currMonth}
          open={Boolean(editingFollowup)}
          onOpenChange={(v) => {
            if (!v) setEditingFollowup(null);
          }}
          onSaved={patchRowLocal}
        />
      )}
    </div>
  );
}
