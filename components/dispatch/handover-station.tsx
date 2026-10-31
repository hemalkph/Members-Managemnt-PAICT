"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckCircle2Icon,
  Loader2Icon,
  ScanBarcodeIcon,
  TruckIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelHandoverAction,
  confirmHandoverAction,
  handoverScanAction,
  openHandoverAction,
  releaseFromHandoverAction,
} from "@/lib/actions/dispatch-handover";
import { RECEIPT_TYPES, receiptExtension, type HandoverScanResult } from "@/lib/dispatch/delivery";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { CameraScanner } from "./camera-scanner";
import { beep } from "./scan-station";

export type HandoverParcel = { id: string; reference: string };

type Tone = "info" | "success" | "warning" | "error";
const TONE: Record<Tone, { box: string; icon: typeof CheckCircle2Icon }> = {
  info: { box: "border-primary/50 bg-primary/5", icon: ScanBarcodeIcon },
  success: { box: "border-success/60 bg-success/10", icon: CheckCircle2Icon },
  warning: { box: "border-warning/60 bg-warning/15", icon: AlertTriangleIcon },
  error: { box: "border-destructive/60 bg-destructive/10", icon: XCircleIcon },
};
const RESULT_TONE: Record<HandoverScanResult["result"], Tone> = {
  ok: "success",
  duplicate: "warning",
  not_ready: "warning",
  wrong_round: "error",
  unknown: "error",
};
const MAX_RECEIPT = 15 * 1024 * 1024;

/** Start a handover when none is open. */
export function StartHandover({ roundId, ready }: { roundId: string; ready: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Give parcels to the courier</CardTitle>
        <CardDescription>
          {ready === 0
            ? "No parcels are ready right now. Parcels must be packed and verified first."
            : `${ready} parcel${ready === 1 ? " is" : "s are"} ready. Start a handover when the Citypak rider arrives, then scan each parcel as you hand it over.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          disabled={pending || ready === 0}
          onClick={() =>
            startTransition(async () => {
              const r = await openHandoverAction({ round_id: roundId });
              if (!r.ok) return void toast.error(r.error);
              router.refresh();
            })
          }
        >
          {pending ? <Loader2Icon className="animate-spin" /> : <TruckIcon />} Start a handover
        </Button>
      </CardContent>
    </Card>
  );
}

export function HandoverStation({
  roundId,
  handoverId,
  initial,
  ready,
}: {
  roundId: string;
  handoverId: string;
  initial: HandoverParcel[];
  ready: number;
}) {
  const router = useRouter();
  const [parcels, setParcels] = useState<HandoverParcel[]>(initial);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: Tone; title: string; detail?: string }>({
    tone: "info",
    title: "Scan each parcel as it goes to the courier",
    detail: "USB scanner, camera, or type the tracking number or reference.",
  });
  const [camera, setCamera] = useState(false);
  const [counted, setCounted] = useState("");
  const [rep, setRep] = useState("");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const focusScan = useCallback(() => setTimeout(() => input.current?.focus(), 0), []);

  const scan = useCallback(
    async (raw: string) => {
      const scanned = raw.trim();
      if (!scanned || busy) return;
      setCode("");
      setBusy(true);
      try {
        const r = await handoverScanAction({ handover_id: handoverId, code: scanned });
        if (!r.ok) {
          setFeedback({ tone: "error", title: "Not added", detail: r.error });
          beep(false);
          return;
        }
        const res = r.data!;
        setFeedback({ tone: RESULT_TONE[res.result], title: res.result === "ok" ? `Added ${res.reference}` : res.reference ?? res.code ?? scanned, detail: res.result === "ok" ? undefined : res.message });
        beep(res.result === "ok");
        if (res.result === "ok" && res.parcel_id) {
          const id = res.parcel_id;
          setParcels((list) => (list.some((p) => p.id === id) ? list : [{ id, reference: res.reference ?? scanned }, ...list]));
        }
      } catch {
        setFeedback({ tone: "error", title: "Not connected", detail: "The scan didn't reach the server. Scan again – it's safe." });
        beep(false);
      } finally {
        setBusy(false);
        focusScan();
      }
    },
    [busy, focusScan, handoverId],
  );

  const release = (p: HandoverParcel) =>
    startTransition(async () => {
      const r = await releaseFromHandoverAction({ handover_id: handoverId, parcel_id: p.id, round_id: roundId });
      if (!r.ok) return void toast.error(r.error);
      setParcels((list) => list.filter((x) => x.id !== p.id));
      toast.success(`${p.reference} removed`);
    });

  const countedNumber = Number.parseInt(counted, 10);
  const matches = parcels.length > 0 && countedNumber === parcels.length;

  const confirm = () =>
    startTransition(async () => {
      let receiptInput: { path: string; name: string } | null = null;
      if (receipt) {
        const ext = receiptExtension(receipt.name);
        if (!ext) return void toast.error("The receipt must be a photo (JPG, PNG, WebP) or a PDF.");
        if (receipt.size > MAX_RECEIPT) return void toast.error("The receipt is larger than 15 MB.");
        const path = `receipts/${roundId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await createClient().storage.from("dispatch").upload(path, receipt, { contentType: RECEIPT_TYPES[ext], upsert: false });
        if (error) return void toast.error("The receipt upload failed. Check your connection and try again.");
        receiptInput = { path, name: receipt.name };
      }
      const r = await confirmHandoverAction({
        round_id: roundId,
        handover_id: handoverId,
        counted: countedNumber,
        courier_rep: rep,
        courier_ref: ref,
        note,
        receipt: receiptInput,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      router.refresh();
    });

  const cancel = () =>
    startTransition(async () => {
      const r = await cancelHandoverAction({ handover_id: handoverId, round_id: roundId, reason: cancelReason });
      if (!r.ok) return void toast.error(r.error);
      setCancelOpen(false);
      toast.success(r.message);
      router.refresh();
    });

  const tone = TONE[feedback.tone];
  const ToneIcon = tone.icon;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            scan(code);
          }}
          className="space-y-1.5"
        >
          <Label htmlFor="handover-code">Scan or type a label</Label>
          <div className="flex gap-2">
            <Input
              id="handover-code"
              ref={input}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="D16950069 or reference"
              className="h-12 font-mono text-lg"
            />
            <Button type="button" variant={camera ? "default" : "outline"} className="h-12" onClick={() => setCamera((c) => !c)} aria-pressed={camera}>
              <CameraIcon /> <span className="sr-only sm:not-sr-only">Camera</span>
            </Button>
          </div>
        </form>
        {camera && <CameraScanner onCode={(c) => scan(c)} onClose={() => setCamera(false)} />}
        <div className={cn("flex gap-3 rounded-lg border-2 p-3", tone.box)} role="status" aria-live="assertive">
          {busy ? <Loader2Icon className="mt-0.5 size-5 shrink-0 animate-spin" /> : <ToneIcon className="mt-0.5 size-5 shrink-0" />}
          <div className="min-w-0">
            <p className="font-semibold">{feedback.title}</p>
            {feedback.detail && <p className="text-muted-foreground text-sm">{feedback.detail}</p>}
          </div>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">
              In this handover: <span className="tabular-nums">{parcels.length}</span>
            </CardTitle>
            <span className="text-muted-foreground text-xs">{Math.max(ready - parcels.length, 0)} more ready</span>
          </CardHeader>
          <CardContent>
            {parcels.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing scanned yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {parcels.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-mono">{p.reference}</span>
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => release(p)} disabled={pending} aria-label={`Remove ${p.reference}`}>
                        <XIcon />
                      </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Confirm with the courier</CardTitle>
          <CardDescription>Count the parcels the rider takes. The count must match the scans.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="counted">Parcels counted</Label>
            <Input
              id="counted"
              inputMode="numeric"
              value={counted}
              onChange={(e) => setCounted(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="h-11 text-lg tabular-nums"
              aria-describedby="counted-help"
            />
            <p id="counted-help" className={cn("text-xs", counted && !matches ? "text-destructive" : "text-muted-foreground")}>
              {counted === ""
                ? `${parcels.length} scanned`
                : matches
                  ? "Matches the scans"
                  : `Counted ${countedNumber || 0}, scanned ${parcels.length} – find the difference first`}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep">Rider / courier name</Label>
            <Input id="rep" value={rep} onChange={(e) => setRep(e.target.value)} maxLength={100} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref">Citypak pickup reference</Label>
            <Input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={100} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="receipt">Receipt (optional photo or PDF)</Label>
            <Input id="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
          </div>
          <Button className="w-full" onClick={confirm} disabled={!matches || pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <TruckIcon />} Confirm handover
          </Button>
          <p className="text-muted-foreground text-xs">This marks them “handed over”, not delivered.</p>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setCancelOpen(true)} disabled={pending}>
            Cancel this handover
          </Button>
        </CardContent>
      </Card>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this handover?</DialogTitle>
            <DialogDescription>Nothing is handed over. The scanned parcels become free for the next handover.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Input id="cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={300} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={cancel} disabled={pending}>
              Cancel handover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
