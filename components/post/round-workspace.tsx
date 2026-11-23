"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeftIcon, EllipsisVerticalIcon, ListIcon, MessageCircleIcon, StickerIcon } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { BarcodeScanButton } from "@/components/post/barcode-scanner";
import { ROUND_STATUS } from "@/components/post/post-workspace";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  cancelRoundAction,
  handOverRoundAction,
  packParcelAction,
  setParcelStatusAction,
  setTrackingAction,
  voidParcelAction,
  whatsappSentAction,
} from "@/lib/actions/post";
import type { ActionResult } from "@/lib/core/action-result";
import { formatDateTime } from "@/lib/core/format";
import { monthLabel } from "@/lib/core/month";
import { feeWhatsAppUrl } from "@/lib/fees/templates";
import type { PostParcel, PostRound } from "@/lib/post/queries";

const TRACKER_URL = "https://slpost.gov.lk/services/speed-post-courier-tracking/";

const PARCEL_STATUS = {
  planned: { label: "To pack", variant: "outline" },
  packed: { label: "Packed", variant: "secondary" },
  handed_over: { label: "Posted", variant: "secondary" },
  delivered: { label: "Delivered", variant: "success" },
  returned: { label: "Came back", variant: "warning" },
  lost: { label: "Lost", variant: "destructive" },
  void: { label: "Taken out", variant: "outline" },
} as const;

function trackingMessage(p: PostParcel, month: string): string {
  const first = p.name.split(/\s|&/)[0];
  return (
    `Hi ${first}, your ${monthLabel(month)} tutes (${p.tutes.join(", ")}) were posted today by Speed Post.\n` +
    `Tracking number: ${p.trackingNo}\nTrack it here: ${TRACKER_URL}`
  );
}

export function RoundWorkspace({ round, canEdit }: { round: PostRound; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quick, setQuick] = useState("");
  const [receipt, setReceipt] = useState("");
  const [confirm, setConfirm] = useState<null | "cancel" | { void: PostParcel } | { returned: PostParcel }>(null);

  const packing = round.status === "packing";
  const live = round.parcelList.filter((p) => p.status !== "void");
  const ready = live.length > 0 && round.packed === live.length && round.tracked === live.length;
  const byNumber = new Map(live.map((p) => [p.number, p]));

  // Parcels with the same tutes are packed together.
  const groups = new Map<string, PostParcel[]>();
  for (const p of round.parcelList) {
    const key = p.status === "void" ? "~" : p.tutes.join(" + ");
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  const run = (fn: () => Promise<ActionResult>, quiet = false) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      if (!quiet) toast.success(res.message);
      setConfirm(null);
      router.refresh();
    });

  const packByNumber = (e: React.FormEvent) => {
    e.preventDefault();
    const p = byNumber.get(Number(quick.replace(/\D/g, "")));
    if (!p) return void toast.error(`No parcel number ${quick} in this round`);
    setQuick("");
    run(() => packParcelAction({ id: p.id, packed: true }));
  };

  const saveTracking = (p: PostParcel, value: string) => {
    if ((p.trackingNo ?? "") === value.trim().toUpperCase().replace(/\s+/g, "")) return;
    run(() => setTrackingAction({ id: p.id, tracking: value }), true);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        leading={
          <Button asChild size="icon" variant="ghost" aria-label="Back to Speed Post">
            <Link href={`/admin/post?batch=${round.batchId}&month=${round.month}`}>
              <ArrowLeftIcon />
            </Link>
          </Button>
        }
        title={
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {monthLabel(round.month)} {round.kind === "main" ? "main round" : "top-up round"}
            </h1>
            <Badge variant={ROUND_STATUS[round.status].variant}>{ROUND_STATUS[round.status].label}</Badge>
          </div>
        }
        description={
          round.handedOverAt
            ? `Handed over ${formatDateTime(round.handedOverAt)}${round.receiptTotal !== null ? ` · receipt Rs. ${round.receiptTotal}` : ""}`
            : `${live.length} parcels · ${round.packed} packed · ${round.tracked} with tracking numbers`
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/admin/post/${round.id}/print`}>
                <StickerIcon /> Labels
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/admin/post/${round.id}/print?view=list`}>
                <ListIcon /> Post list
              </Link>
            </Button>
            {canEdit && packing && (
              <Button variant="ghost" onClick={() => setConfirm("cancel")}>
                Cancel round
              </Button>
            )}
          </>
        }
      />

      {packing && canEdit && (
        <Card>
          <CardContent className="grid gap-4 pt-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>
                  Packed {round.packed} / {live.length} · tracking {round.tracked} / {live.length}
                </span>
              </div>
              <Progress value={live.length ? ((round.packed + round.tracked) / (2 * live.length)) * 100 : 0} />
              <form onSubmit={packByNumber} className="flex max-w-xs items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="quick-pack">Packed parcel number</Label>
                  <Input id="quick-pack" inputMode="numeric" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="e.g. 12" />
                </div>
                <Button type="submit" variant="outline" disabled={pending || !quick}>
                  Packed
                </Button>
              </form>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="receipt">Post office receipt Rs. (optional)</Label>
                <Input id="receipt" inputMode="decimal" className="w-40" value={receipt} onChange={(e) => setReceipt(e.target.value)} />
              </div>
              <Button
                disabled={pending || !ready}
                onClick={() =>
                  run(() => handOverRoundAction({ id: round.id, receipt_total: receipt.trim() === "" ? null : Number(receipt) }))
                }
              >
                Handed over at the post office
              </Button>
            </div>
            {!ready && (
              <p className="text-muted-foreground text-xs lg:col-span-2">
                Every parcel needs to be packed and have its Speed Post tracking number before handover. Copies leave stock
                at handover.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {[...groups.entries()].map(([tutes, parcels]) => (
        <Card key={tutes} className="gap-2">
          <CardHeader>
            <CardTitle className="text-base">
              {tutes === "~" ? "Taken out" : `${parcels.length} parcel${parcels.length === 1 ? "" : "s"}: ${tutes}`}
            </CardTitle>
            {tutes !== "~" && packing && <CardDescription>Pack these the same way.</CardDescription>}
          </CardHeader>
          <CardContent className="divide-y px-0">
            {parcels.map((p) => (
              <div key={p.id} className="flex flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {packing && canEdit && p.status !== "void" ? (
                    <Checkbox
                      className="mt-1 size-5"
                      checked={p.status === "packed"}
                      aria-label={`Parcel ${p.number} packed`}
                      disabled={pending}
                      onCheckedChange={(v) => run(() => packParcelAction({ id: p.id, packed: v === true }), true)}
                    />
                  ) : null}
                  <span className="text-muted-foreground w-8 shrink-0 text-lg font-semibold tabular-nums">{p.number}</span>
                  <div className="min-w-0">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-muted-foreground line-clamp-2 text-xs whitespace-pre-line">{p.address}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:w-auto">
                  {packing && canEdit && p.status !== "void" ? (
                    <>
                      <Input
                        key={p.trackingNo ?? "none"}
                        aria-label={`Tracking number for parcel ${p.number}`}
                        placeholder="Tracking number"
                        defaultValue={p.trackingNo ?? ""}
                        className="h-8 w-44 font-mono uppercase"
                        onBlur={(e) => saveTracking(p, e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                      />
                      <BarcodeScanButton label={`Scan tracking number for parcel ${p.number}`} onResult={(code) => saveTracking(p, code)} />
                    </>
                  ) : (
                    p.trackingNo && <span className="font-mono text-sm">{p.trackingNo}</span>
                  )}
                  <Badge variant={PARCEL_STATUS[p.status].variant}>{PARCEL_STATUS[p.status].label}</Badge>

                  {canEdit && !packing && p.trackingNo && p.whatsapp && ["handed_over", "delivered"].includes(p.status) && (
                    <Button asChild size="sm" variant={p.waSentAt ? "ghost" : "outline"}>
                      <a
                        href={feeWhatsAppUrl(p.whatsapp, trackingMessage(p, round.month))}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => !p.waSentAt && run(() => whatsappSentAction(p.id), true)}
                      >
                        <MessageCircleIcon /> {p.waSentAt ? "Sent" : "Send tracking"}
                      </a>
                    </Button>
                  )}

                  {canEdit && (p.status === "handed_over" || p.status === "delivered" || (packing && p.status !== "void")) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="size-8" aria-label={`More for parcel ${p.number}`}>
                          <EllipsisVerticalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {packing ? (
                          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ void: p })}>
                            Take out of this round
                          </DropdownMenuItem>
                        ) : (
                          <>
                            {p.status === "handed_over" && (
                              <DropdownMenuItem onSelect={() => run(() => setParcelStatusAction({ id: p.id, status: "delivered" }))}>
                                Delivered
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => setConfirm({ returned: p })}>Came back</DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => run(() => setParcelStatusAction({ id: p.id, status: "lost" }))}
                            >
                              Lost
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <AlertDialog open={confirm !== null} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "cancel"
                ? "Cancel this round?"
                : confirm && "void" in confirm
                  ? `Take parcel ${confirm.void.number} out?`
                  : "Parcel came back"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "cancel"
                ? "Its held copies become free again and its students can go in another round."
                : confirm && "void" in confirm
                  ? `${confirm.void.name} won't get a parcel in this round. Their copies become free again.`
                  : "Are the copies still usable? Usable copies go back into stock. The student can be sent the tutes again after their address is checked."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            {confirm && confirm !== "cancel" && "returned" in confirm && (
              <Button
                variant="outline"
                onClick={() => run(() => setParcelStatusAction({ id: confirm.returned.id, status: "returned", copies_ok: false }))}
              >
                Damaged
              </Button>
            )}
            <AlertDialogAction
              onClick={() => {
                if (confirm === "cancel") run(() => cancelRoundAction(round.id));
                else if (confirm && "void" in confirm) run(() => voidParcelAction(confirm.void.id));
                else if (confirm && "returned" in confirm)
                  run(() => setParcelStatusAction({ id: confirm.returned.id, status: "returned", copies_ok: true }));
              }}
            >
              {confirm === "cancel" ? "Cancel round" : confirm && "void" in confirm ? "Take out" : "Usable — back in stock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
