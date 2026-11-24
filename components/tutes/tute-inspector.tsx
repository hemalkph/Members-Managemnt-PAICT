"use client";

import { useRef, useState } from "react";
import {
  BookCopyIcon,
  CameraIcon,
  CornerDownLeftIcon,
  EllipsisVerticalIcon,
  FileCheckIcon,
  HandIcon,
  HistoryIcon,
  Loader2Icon,
  PackageCheckIcon,
  PrinterIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import Counter from "@/components/reactbits/counter";
import FadeContent from "@/components/reactbits/fade-content";
import { BOOKLET_KIND_META, BookletEmblem, SupplyGauge, VERDICT_TEXT_CLASS } from "@/components/tutes/booklet-emblem";
import { CameraCaptureDialog } from "@/components/tutes/cover-photo-picker";
import { KIND, STATUS, type DialogState } from "@/components/tutes/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "@/lib/core/format";
import { monthLabel } from "@/lib/core/month";
import type { TuteClassNeed, TuteStockRow } from "@/lib/supabase/database.types";
import { inferTuteKind, leftThisMonth, needSource, orderBreakdown, shelfVerdict } from "@/lib/tutes/helpers";
import type { TuteMove, TutePrintJob } from "@/lib/tutes/queries";
import { cn } from "@/lib/utils";

/**
 * Sticky Master-Detail Tute Inspector (desktop side panel + mobile Sheet body).
 * Surfaces Free vs Held-for-Post stock, inline shelf counting without modals,
 * Hall vs Online class demand, and recent activity for the selected booklet.
 */
export function TuteInspector({
  row,
  moves,
  openJobs,
  held,
  coverUrl,
  month,
  nextMonth,
  canEdit,
  pending,
  uploadingCover,
  onInlineCount,
  onUploadCover,
  onRemoveCover,
  onOpenDialog,
  onOpenReceive,
  onOpenHistory,
  onDelete,
}: {
  row: TuteStockRow | null;
  moves: TuteMove[];
  openJobs: TutePrintJob[];
  held: number;
  coverUrl: string | null;
  month: string;
  nextMonth: string;
  canEdit: boolean;
  pending: boolean;
  uploadingCover: boolean;
  onInlineCount: (tuteId: string, counted: number) => void;
  onUploadCover: (tuteId: string, file: File) => void;
  onRemoveCover: (tuteId: string) => void;
  onOpenDialog: (state: DialogState) => void;
  onOpenReceive: (tuteId: string) => void;
  onOpenHistory: (tuteId: string) => void;
  onDelete: (row: TuteStockRow) => void;
}) {
  if (!row) {
    return (
      <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 p-8 text-center text-xs">
        <BookCopyIcon className="size-5 opacity-50" />
        <p>Select a booklet from the shelf to inspect its copies and classes.</p>
      </div>
    );
  }

  return (
    <TuteInspectorBody
      key={row.tute_id}
      row={row}
      moves={moves}
      openJobs={openJobs}
      held={held}
      coverUrl={coverUrl}
      month={month}
      nextMonth={nextMonth}
      canEdit={canEdit}
      pending={pending}
      uploadingCover={uploadingCover}
      onInlineCount={onInlineCount}
      onUploadCover={onUploadCover}
      onRemoveCover={onRemoveCover}
      onOpenDialog={onOpenDialog}
      onOpenReceive={onOpenReceive}
      onOpenHistory={onOpenHistory}
      onDelete={onDelete}
    />
  );
}

function TuteInspectorBody({
  row,
  moves,
  openJobs,
  held,
  coverUrl,
  month,
  nextMonth,
  canEdit,
  pending,
  uploadingCover,
  onInlineCount,
  onUploadCover,
  onRemoveCover,
  onOpenDialog,
  onOpenReceive,
  onOpenHistory,
  onDelete,
}: {
  row: TuteStockRow;
  moves: TuteMove[];
  openJobs: TutePrintJob[];
  held: number;
  coverUrl: string | null;
  month: string;
  nextMonth: string;
  canEdit: boolean;
  pending: boolean;
  uploadingCover: boolean;
  onInlineCount: (tuteId: string, counted: number) => void;
  onUploadCover: (tuteId: string, file: File) => void;
  onRemoveCover: (tuteId: string) => void;
  onOpenDialog: (state: DialogState) => void;
  onOpenReceive: (tuteId: string) => void;
  onOpenHistory: (tuteId: string) => void;
  onDelete: (row: TuteStockRow) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const left = leftThisMonth(row);
  const free = Math.max(row.on_hand - held, 0);
  const verdict = shelfVerdict(row);
  const kind = inferTuteKind(row.name, row.code);
  const kindMeta = BOOKLET_KIND_META[kind];
  const tuteMoves = moves.filter((m) => m.tuteId === row.tute_id).slice(0, 4);

  const short = row.status === "out" || row.status === "low";
  const hasOpenJob = openJobs.length > 0;

  const openCamera = () => {
    if (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
      setCameraOpen(true);
    } else {
      captureRef.current?.click();
    }
  };

  return (
    <FadeContent className="flex max-h-[calc(100dvh-7rem)] flex-col">
      {/* Header: Booklet cover (1-click upload or camera snap) + title + overflow */}
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3.5">
          {canEdit ? (
            <div className="relative shrink-0">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadCover(row.tute_id, file);
                  e.target.value = "";
                }}
              />
              <input
                ref={captureRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadCover(row.tute_id, file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={uploadingCover}
                onClick={() => fileRef.current?.click()}
                aria-label={coverUrl ? `Change cover photo for ${row.name}` : `Upload cover photo for ${row.name}`}
                className="group/cover focus-visible:ring-ring/50 relative block cursor-pointer rounded-md focus-visible:ring-[3px] focus-visible:outline-none disabled:opacity-60"
              >
                <BookletEmblem
                  name={row.name}
                  code={row.code}
                  coverUrl={coverUrl}
                  paperReady={row.paper_ready}
                  size="lg"
                  glare
                />
                <span
                  className={cn(
                    "absolute inset-0 flex items-center justify-center rounded-md bg-black/55 text-white transition-opacity",
                    uploadingCover ? "opacity-100" : "opacity-0 group-hover/cover:opacity-100",
                  )}
                >
                  {uploadingCover ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <UploadIcon className="size-4" />
                  )}
                </span>
              </button>
            </div>
          ) : (
            <BookletEmblem
              name={row.name}
              code={row.code}
              coverUrl={coverUrl}
              paperReady={row.paper_ready}
              size="lg"
              glare
            />
          )}

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm leading-snug font-semibold text-balance break-words">{row.name}</h3>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="size-7 shrink-0"
                      aria-label={`More actions for ${row.name}`}
                    >
                      <EllipsisVerticalIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                      {coverUrl ? "Upload new cover" : "Upload cover photo"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={openCamera}>Take cover photo</DropdownMenuItem>
                    {coverUrl && (
                      <DropdownMenuItem onSelect={() => onRemoveCover(row.tute_id)}>
                        Remove cover photo
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "tute", row })}>Edit tute</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onOpenDialog({ kind: "damaged", row })}>
                      Mark damaged
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onOpenHistory(row.tute_id)}>Full stock history</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(row)}>
                      Delete tute
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
              <Badge variant={STATUS[row.status].variant} className="text-[11px]">
                {STATUS[row.status].label}
              </Badge>
              <span>{kindMeta.label}</span>
              {row.pages && <span className="tabular-nums">· {row.pages}p</span>}
              {row.print_batch > 1 && <span className="tabular-nums">· ×{row.print_batch}</span>}
              {row.paper_ready && (
                <span className="text-success inline-flex items-center gap-1 font-medium">
                  · <FileCheckIcon className="size-3" /> PDF
                </span>
              )}
            </div>

            {/* Always-discoverable touch-friendly Upload + Camera cover actions */}
            {canEdit && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  disabled={uploadingCover}
                  onClick={() => fileRef.current?.click()}
                  className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium transition-colors disabled:opacity-50"
                >
                  {uploadingCover ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : (
                    <UploadIcon className="size-3" />
                  )}
                  {uploadingCover ? "Uploading…" : coverUrl ? "Change" : "Upload"}
                </button>
                <span className="text-border">·</span>
                <button
                  type="button"
                  disabled={uploadingCover}
                  onClick={openCamera}
                  className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium transition-colors disabled:opacity-50"
                >
                  <CameraIcon className="size-3" /> Take photo
                </button>
                {coverUrl && !uploadingCover && (
                  <>
                    <span className="text-border">·</span>
                    <button
                      type="button"
                      onClick={() => onRemoveCover(row.tute_id)}
                      className="text-muted-foreground hover:text-destructive inline-flex cursor-pointer items-center gap-1 text-[11px] transition-colors"
                    >
                      <Trash2Icon className="size-3" /> Remove
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {cameraOpen && (
          <CameraCaptureDialog
            onClose={() => setCameraOpen(false)}
            onFallbackUpload={() => {
              setCameraOpen(false);
              captureRef.current?.click();
            }}
            onCapture={(file) => {
              setCameraOpen(false);
              onUploadCover(row.tute_id, file);
            }}
          />
        )}

        {/* Mechanical rolling copy counters (React Bits Counter) */}
        <div className="bg-background/70 grid grid-cols-3 divide-x rounded-lg border py-2.5 text-center">
          <div className="px-2">
            <p className="text-muted-foreground text-[11px]">On shelf</p>
            <div className={cn("mt-1 flex justify-center text-lg font-bold", VERDICT_TEXT_CLASS[verdict.tone])}>
              {row.status === "not_counted" ? (
                <span className="leading-none">?</span>
              ) : (
                <Counter value={row.on_hand} height={22} />
              )}
            </div>
            {row.in_print > 0 && (
              <p className="text-primary mt-0.5 text-[11px] font-medium tabular-nums">+{row.in_print} printing</p>
            )}
          </div>

          <div className="px-2">
            <p className="text-muted-foreground text-[11px]">Free</p>
            <div className="mt-1 flex justify-center text-lg font-bold">
              {row.status === "not_counted" ? (
                <span className="text-muted-foreground leading-none">—</span>
              ) : (
                <Counter value={free} height={22} />
              )}
            </div>
            {held > 0 && <p className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">{held} for post</p>}
          </div>

          <div className="px-2">
            <p className="text-muted-foreground text-[11px]">{monthLabel(month, "short")} left</p>
            <div className="mt-1 flex justify-center text-lg font-bold">
              <Counter value={left} height={22} />
            </div>
            {row.need_next > 0 && (
              <p className="text-muted-foreground mt-0.5 text-[11px] tabular-nums">
                {monthLabel(nextMonth, "short")}: {row.need_next}
              </p>
            )}
          </div>
        </div>

        {/* 10-block Physical Stack Supply Gauge + Verdict */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className={cn("font-semibold", VERDICT_TEXT_CLASS[verdict.tone])}>{verdict.label}</span>
          <SupplyGauge row={row} />
        </div>
      </div>

      <Separator />

      {/* Scrollable middle: Inline Count + Classes + Activity */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y">
          {/* Inline Quick Shelf Count (no popup required) */}
          {canEdit && (
            <InlineCountForm
              key={`${row.tute_id}:${row.status}:${row.on_hand}`}
              row={row}
              pending={pending}
              onInlineCount={onInlineCount}
            />
          )}

          {/* Primary Quick Actions */}
          {canEdit && (
            <div className="grid grid-cols-2 gap-2 p-4">
              {short && hasOpenJob ? (
                <Button size="sm" onClick={() => onOpenReceive(row.tute_id)}>
                  <PackageCheckIcon /> Receive ({row.in_print})
                </Button>
              ) : short ? (
                <Button size="sm" variant="destructive" onClick={() => onOpenDialog({ kind: "job", row })}>
                  <PrinterIcon /> Order{row.print_now > 0 ? ` ${row.print_now}` : " print"}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => onOpenDialog({ kind: "issue", row })}>
                  <HandIcon /> Give to class
                </Button>
              )}

              {short ? (
                <Button size="sm" variant="outline" onClick={() => onOpenDialog({ kind: "issue", row })}>
                  <HandIcon /> Give to class
                </Button>
              ) : hasOpenJob ? (
                <Button size="sm" variant="outline" onClick={() => onOpenReceive(row.tute_id)}>
                  <PackageCheckIcon /> Receive
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => onOpenDialog({ kind: "job", row })}>
                  <PrinterIcon /> New print job
                </Button>
              )}
            </div>
          )}

          {/* Class Demand Breakdown (always visible, no hidden popover!) */}
          <div className="space-y-2.5 p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">{monthLabel(month)} classes</span>
              {row.need_this > 0 && (
                <span className="text-muted-foreground tabular-nums">
                  {row.given_this} / {row.need_this} given
                </span>
              )}
            </div>
            {row.classes.length === 0 ? (
              <p className="text-muted-foreground text-xs">Not scheduled for any class in {monthLabel(month)}.</p>
            ) : (
              <div className="space-y-1.5">
                {row.classes.map((c) => (
                  <ClassDemandRow key={c.id} item={c} showGiven />
                ))}
              </div>
            )}

            {row.classes_next.length > 0 && (
              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">{monthLabel(nextMonth)} forecast</span>
                  <span className="text-muted-foreground tabular-nums">{row.need_next} copies</span>
                </div>
                {row.classes_next.map((c) => (
                  <ClassDemandRow key={c.id} item={c} />
                ))}
              </div>
            )}

            {row.print_now > 0 && (
              <div className="bg-muted/40 space-y-1 rounded-lg border px-3 py-2 text-[11px]">
                <p className="text-foreground font-medium">Order {row.print_now}</p>
                <p className="text-muted-foreground tabular-nums">{orderBreakdown(row)}</p>
                {row.safety > 0 && (
                  <p className="text-muted-foreground">
                    Spare: 5% extra (at least 5), more while a class&apos;s count is still a guess.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Recent Stock Moves */}
          <div className="space-y-2 p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">Recent activity</span>
              <button
                type="button"
                onClick={() => onOpenHistory(row.tute_id)}
                className="text-primary inline-flex cursor-pointer items-center gap-1 hover:underline"
              >
                <HistoryIcon className="size-3" /> All history
              </button>
            </div>
            {tuteMoves.length === 0 ? (
              <p className="text-muted-foreground text-xs">No counts or stock movements recorded yet.</p>
            ) : (
              <ul className="divide-y">
                {tuteMoves.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 py-1.5 text-xs first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {KIND[m.kind]}
                        {m.className ? ` · ${m.className}` : ""}
                      </p>
                      <p className="text-muted-foreground truncate text-[11px]">
                        {m.by} · {formatDateTime(m.createdAt)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-xs font-semibold tabular-nums",
                        m.qty > 0 ? "text-success" : "text-foreground",
                      )}
                    >
                      {m.qty > 0 ? `+${m.qty}` : m.qty}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </ScrollArea>
    </FadeContent>
  );
}

function InlineCountForm({
  row,
  pending,
  onInlineCount,
}: {
  row: TuteStockRow;
  pending: boolean;
  onInlineCount: (tuteId: string, counted: number) => void;
}) {
  const [draftCount, setDraftCount] = useState(row.status === "not_counted" ? "" : String(row.on_hand));
  const parsedDraft = draftCount.trim() === "" ? null : Number(draftCount);
  const draftValid =
    parsedDraft !== null && Number.isInteger(parsedDraft) && parsedDraft >= 0 && parsedDraft <= 100000;
  const draftUnchanged = row.status !== "not_counted" && parsedDraft === row.on_hand;
  const presets = [0, 50, 100, 150, 200];

  const submitDraft = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftValid || draftUnchanged || pending || parsedDraft === null) return;
    onInlineCount(row.tute_id, parsedDraft);
  };

  return (
    <form onSubmit={submitDraft} className="space-y-2.5 p-4">
      <div className="flex items-center justify-between gap-2 text-xs">
        <label htmlFor={`inspector-count-${row.tute_id}`} className="font-semibold">
          {row.status === "not_counted" ? "Record first shelf count" : "Update shelf count"}
        </label>
        <span className="text-muted-foreground inline-flex items-center gap-1">
          Press <Kbd>↵</Kbd>
        </span>
      </div>

      <InputGroup className="h-8 bg-background/70">
        <InputGroupInput
          id={`inspector-count-${row.tute_id}`}
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          step={1}
          value={draftCount}
          onChange={(e) => setDraftCount(e.target.value)}
          placeholder="Copies on shelf…"
          className="h-8 text-sm tabular-nums"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="submit"
            variant="secondary"
            size="xs"
            disabled={!draftValid || draftUnchanged || pending}
          >
            {pending ? <Loader2Icon className="size-3 animate-spin" /> : <CornerDownLeftIcon className="size-3" />}
            Save
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      <ButtonGroup className="w-full">
        {presets.map((preset) => (
          <Button
            key={preset}
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || (row.status !== "not_counted" && row.on_hand === preset)}
            onClick={() => {
              setDraftCount(String(preset));
              onInlineCount(row.tute_id, preset);
            }}
            className="h-7 flex-1 px-0 text-xs tabular-nums"
          >
            {preset}
          </Button>
        ))}
      </ButtonGroup>
    </form>
  );
}

function ClassDemandRow({ item, showGiven = false }: { item: TuteClassNeed; showGiven?: boolean }) {
  const hallExpected = Math.max(item.expected - item.online, 0);
  const hallGiven = item.hall_given ?? 0;

  return (
    <div className="bg-background/60 rounded-lg border px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2 font-medium">
        <span className="truncate">
          {item.name}
          {item.batch && <span className="text-muted-foreground font-normal"> · {item.batch}</span>}
        </span>
        <span className="shrink-0 tabular-nums">
          {item.uploaded ? item.expected : `~${item.expected}`}
        </span>
      </div>
      <p className="text-muted-foreground mt-0.5 text-[11px]">From {needSource(item)}</p>
      <div className="text-muted-foreground mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] tabular-nums">
        {showGiven ? (
          item.online > 0 ? (
            <>
              <span>
                Hall: {hallGiven} / {hallExpected} given
              </span>
              <span>Online (Post): {item.online}</span>
            </>
          ) : (
            <span>
              Given: {item.given} / {item.expected}
            </span>
          )
        ) : (
          <>
            <span>Hall: {hallExpected}</span>
            {item.online > 0 && <span>Online (Post): {item.online}</span>}
          </>
        )}
      </div>
    </div>
  );
}
