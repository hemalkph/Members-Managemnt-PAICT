"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckCircle2Icon,
  CheckIcon,
  Loader2Icon,
  PackageCheckIcon,
  RotateCcwIcon,
  ScanBarcodeIcon,
  Volume2Icon,
  VolumeXIcon,
  WifiIcon,
  WifiOffIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress as Bar } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmScanAction, lookupScanAction, reportProblemAction, roundProgressAction } from "@/lib/actions/dispatch-packing";
import { PROBLEM_KINDS, type ConfirmResult, type LookupResult, type ParcelCard, type Progress, type ScanMode } from "@/lib/dispatch/packing";
import { canConfirm, CONFIRM_DELAY_MS, isConfirmShortcut } from "@/lib/dispatch/scanner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { CameraScanner } from "./camera-scanner";

type Tone = "info" | "success" | "warning" | "error";
type Feedback = { tone: Tone; title: string; detail?: string } | null;
type Recent = { reference: string; result: string; tone: Tone; at: string };

const TONE: Record<Tone, { box: string; icon: typeof CheckCircle2Icon }> = {
  info: { box: "border-primary/50 bg-primary/5", icon: ScanBarcodeIcon },
  success: { box: "border-success/60 bg-success/10", icon: CheckCircle2Icon },
  warning: { box: "border-warning/60 bg-warning/15", icon: AlertTriangleIcon },
  error: { box: "border-destructive/60 bg-destructive/10", icon: XCircleIcon },
};

const LOOKUP_TONE: Record<LookupResult["result"], Tone> = {
  ready: "info",
  duplicate: "warning",
  not_ready: "warning",
  not_assigned: "warning",
  blocked: "error",
  wrong_round: "error",
  unknown: "error",
};
const LOOKUP_TITLE: Record<LookupResult["result"], string> = {
  ready: "Check the tutes",
  duplicate: "Already done",
  not_ready: "Not ready",
  not_assigned: "Not assigned to you",
  blocked: "Can't change this parcel",
  wrong_round: "Wrong round",
  unknown: "Unknown code",
};

/** Short sounds (no files): a high beep for success, a low double beep for problems. */
function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const tones = ok ? [880] : [260, 200];
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + (ok ? 0.12 : 0.15));
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    // Sound is optional.
  }
}

// Online status and the sound preference come from the browser, read the React way.
function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
function readSound(): boolean {
  try {
    return localStorage.getItem("dispatch-sound") !== "off";
  } catch {
    return true;
  }
}
function subscribeSound(cb: () => void) {
  window.addEventListener("dispatch-sound", cb);
  return () => window.removeEventListener("dispatch-sound", cb);
}
function writeSound(on: boolean) {
  try {
    localStorage.setItem("dispatch-sound", on ? "on" : "off");
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("dispatch-sound"));
}

function deviceId(): string {
  try {
    const existing = localStorage.getItem("dispatch-device");
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem("dispatch-device", id);
    return id;
  } catch {
    return "browser";
  }
}

export function ScanStation({
  roundId,
  roundName,
  canPack,
  canVerify,
  verificationOn,
  initialProgress,
}: {
  roundId: string;
  roundName: string;
  canPack: boolean;
  canVerify: boolean;
  verificationOn: boolean;
  initialProgress: Progress;
}) {
  const [mode, setMode] = useState<ScanMode>(canPack ? "pack" : "verify");
  const [code, setCode] = useState("");
  const [card, setCard] = useState<ParcelCard | null>(null);
  const [cardKey, setCardKey] = useState("");
  const [openedAt, setOpenedAt] = useState(0);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"lookup" | "confirm" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({ tone: "info", title: "Ready", detail: "Scan a Citypak label or type a reference." });
  const [retry, setRetry] = useState(false);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [progress, setProgress] = useState(initialProgress);
  const [camera, setCamera] = useState(false);
  const sound = useSyncExternalStore(subscribeSound, readSound, () => true);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [now, setNow] = useState(0);
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemKind, setProblemKind] = useState<string>("missing_item");
  const [problemNote, setProblemNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const device = useMemo(() => (typeof window === "undefined" ? "browser" : deviceId()), []);

  const focusScan = useCallback(() => setTimeout(() => input.current?.focus(), 0), []);
  const itemIds = useMemo(() => card?.items.map((i) => i.id) ?? [], [card]);
  const ready = card !== null && cardKey !== "";
  const confirmable = ready && canConfirm({ itemIds, ticked, openedAt, now, pending: busy !== null });

  // ------------------------------------------------------------------ live progress
  const refreshProgress = useCallback(async () => {
    const result = await roundProgressAction({ round_id: roundId });
    if (result.ok && result.data) setProgress(result.data);
  }, [roundId]);

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`parcels-${roundId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "parcels", filter: `round_id=eq.${roundId}` }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(refreshProgress, 500);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [roundId, refreshProgress]);

  // ------------------------------------------------------------------ clock for the confirm delay
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setNow(Date.now()), CONFIRM_DELAY_MS + 20);
    return () => clearTimeout(t);
  }, [ready, openedAt]);

  const say = useCallback(
    (f: Feedback, ok?: boolean) => {
      setFeedback(f);
      if (sound && ok !== undefined) beep(ok);
    },
    [sound],
  );

  // ------------------------------------------------------------------ 1. look up (the only thing Enter does)
  const lookup = useCallback(
    async (raw: string) => {
      const scanned = raw.trim();
      if (!scanned || busy) return;
      setCode("");
      const unconfirmed = ready ? card?.reference : null;
      setBusy("lookup");
      setRetry(false);
      try {
        const result = await lookupScanAction({ round_id: roundId, code: scanned, mode, device });
        if (!result.ok) {
          say({ tone: "error", title: "Lookup failed", detail: result.error }, false);
          return;
        }
        const r = result.data!;
        const notice = unconfirmed && unconfirmed !== r.card?.reference ? ` (${unconfirmed} was not confirmed – it is unchanged)` : "";
        if (r.result === "ready" && r.card) {
          setCard(r.card);
          setTicked(new Set());
          setCardKey(crypto.randomUUID());
          const opened = Date.now();
          setOpenedAt(opened);
          setNow(opened);
          say({ tone: "info", title: `${r.card.reference} – check the tutes`, detail: `Tick each tute as it goes in.${notice}` });
        } else {
          setCard(r.card ?? null);
          setCardKey("");
          say(
            {
              tone: LOOKUP_TONE[r.result],
              title: LOOKUP_TITLE[r.result],
              detail: `${r.message ?? ""}${r.result === "unknown" || r.result === "wrong_round" ? ` Scanned: ${r.code ?? scanned}` : ""}${notice}`,
            },
            false,
          );
          setRecent((list) => [{ reference: r.card?.reference ?? r.code ?? scanned, result: LOOKUP_TITLE[r.result], tone: LOOKUP_TONE[r.result], at: new Date().toLocaleTimeString() }, ...list].slice(0, 12));
        }
      } catch {
        say({ tone: "error", title: "Not connected", detail: "The lookup didn't reach the server. Scan again." }, false);
      } finally {
        setBusy(null);
        focusScan();
      }
    },
    [busy, card, device, focusScan, mode, ready, roundId, say],
  );

  // ------------------------------------------------------------------ 3. confirm (button, Ctrl+Enter or F9 – never plain Enter)
  const confirm = useCallback(async () => {
    if (!card || !confirmable) return;
    setBusy("confirm");
    setFeedback({ tone: "info", title: "Saving…", detail: card.reference });
    try {
      const result = await confirmScanAction({
        parcel_id: card.id,
        round_id: roundId,
        mode,
        key: cardKey,
        row_version: card.row_version,
        checked: [...ticked],
        device,
      });
      if (!result.ok) {
        say({ tone: "error", title: "Not saved", detail: result.error }, false);
        setRetry(true);
        return;
      }
      const r: ConfirmResult = result.data!;
      setRetry(false);
      if (r.result === "ok") {
        say({ tone: "success", title: r.message, detail: r.replayed ? "Already saved earlier – nothing changed." : "Saved. Scan the next parcel." }, true);
        setRecent((list) => [{ reference: card.reference, result: mode === "pack" ? "Packed" : "Verified", tone: "success" as Tone, at: new Date().toLocaleTimeString() }, ...list].slice(0, 12));
        setCard(null);
        setCardKey("");
        refreshProgress();
      } else {
        say({ tone: r.result === "items" ? "warning" : "error", title: r.result === "changed" ? "Changed meanwhile" : "Not saved", detail: r.message }, false);
        if (r.result !== "items") {
          setCard(null);
          setCardKey("");
        }
      }
    } catch {
      // The request may or may not have arrived: keep the card and the same key so Retry is safe.
      say({ tone: "error", title: "Not saved (connection)", detail: "Press Retry – it is safe to send again." }, false);
      setRetry(true);
    } finally {
      setBusy(null);
      focusScan();
    }
  }, [card, cardKey, confirmable, device, focusScan, mode, refreshProgress, roundId, say, ticked]);

  // Keys: Ctrl+Enter / F9 confirm. Typing anywhere goes into the scan box (scanners type fast).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (problemOpen) return;
      if (isConfirmShortcut(e)) {
        e.preventDefault();
        confirm();
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (!typing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, problemOpen]);

  const report = async () => {
    if (!card) return;
    const result = await reportProblemAction({ parcel_id: card.id, kind: problemKind, note: problemNote });
    setProblemOpen(false);
    setProblemNote("");
    if (!result.ok) return void toast.error(result.error);
    say({ tone: "warning", title: `${card.reference} is on hold`, detail: "A planner will sort it out. Scan the next parcel." }, false);
    setCard(null);
    setCardKey("");
    refreshProgress();
    focusScan();
  };

  const tone = feedback ? TONE[feedback.tone] : TONE.info;
  const ToneIcon = tone.icon;
  const doneCount = mode === "pack" ? progress.packed : progress.verified;
  const target = mode === "pack" ? progress.registered : progress.packed;

  return (
    <div className="grid gap-4 pb-24 lg:grid-cols-[280px_minmax(0,1fr)_260px] lg:pb-0">
      {/* ------------------------------------------------------------ left: input */}
      <div className="space-y-3">
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span className="truncate">{roundName}</span>
          <span className={cn("inline-flex items-center gap-1", online ? "text-success" : "text-destructive")} role="status">
            {online ? <WifiIcon className="size-3.5" /> : <WifiOffIcon className="size-3.5" />} {online ? "Online" : "Offline"}
          </span>
        </div>
        {canPack && canVerify && verificationOn && (
          <div className="grid grid-cols-2 gap-1 rounded-lg border p-1" role="radiogroup" aria-label="Mode">
            {(["pack", "verify"] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? "default" : "ghost"}
                role="radio"
                aria-checked={mode === m}
                onClick={() => {
                  setMode(m);
                  setCard(null);
                  setCardKey("");
                  focusScan();
                }}
              >
                {m === "pack" ? "Pack" : "Verify"}
              </Button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            lookup(code);
          }}
          className="space-y-1.5"
        >
          <Label htmlFor="scan-code">Scan or type a label</Label>
          <Input
            id="scan-code"
            ref={input}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="D16950069 or reference"
            className="h-12 font-mono text-lg"
            disabled={!online}
          />
          <p className="text-muted-foreground text-xs">Enter only looks the parcel up. It never confirms.</p>
        </form>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={camera ? "default" : "outline"} size="sm" onClick={() => setCamera((c) => !c)}>
            <CameraIcon /> {camera ? "Close camera" : "Camera"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={sound}
            onClick={() => writeSound(!sound)}
          >
            {sound ? <Volume2Icon /> : <VolumeXIcon />} Sound
          </Button>
        </div>
        {camera && <CameraScanner onCode={(c) => lookup(c)} onClose={() => setCamera(false)} />}
      </div>

      {/* ------------------------------------------------------------ centre: parcel */}
      <div className="space-y-3">
        <div className={cn("flex gap-3 rounded-lg border-2 p-3", tone.box)} role="status" aria-live="assertive">
          {busy ? <Loader2Icon className="mt-0.5 size-5 shrink-0 animate-spin" /> : <ToneIcon className="mt-0.5 size-5 shrink-0" />}
          <div className="min-w-0">
            <p className="font-semibold">{feedback?.title}</p>
            {feedback?.detail && <p className="text-sm">{feedback.detail}</p>}
            {retry && card && (
              <Button size="sm" className="mt-2" onClick={confirm}>
                <RotateCcwIcon /> Retry
              </Button>
            )}
          </div>
        </div>

        {card && (
          <Card className="gap-3">
            <CardHeader>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <CardTitle className="font-mono text-2xl tracking-tight sm:text-3xl">{card.reference}</CardTitle>
                <span className="text-muted-foreground font-mono text-sm">{card.tracking_no ?? "no tracking"}</span>
              </div>
              <p className="text-muted-foreground text-sm">
                Student <span className="text-foreground font-mono font-semibold">{card.student_no}</span>
                {card.assigned_name ? ` · assigned to ${card.assigned_name}` : ""}
                {card.packed_name ? ` · packed by ${card.packed_name}` : ""}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-2" aria-label="Tutes in this parcel">
                {card.items.map((item) => (
                  <li key={item.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-base",
                        ticked.has(item.id) && "border-success/60 bg-success/10",
                        !ready && "cursor-default opacity-70",
                      )}
                    >
                      <Checkbox
                        className="size-6"
                        checked={ticked.has(item.id)}
                        disabled={!ready || busy !== null}
                        onCheckedChange={(v) =>
                          setTicked((prev) => {
                            const next = new Set(prev);
                            if (v === true) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          })
                        }
                      />
                      <span className="font-mono font-semibold">{item.code}</span>
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {item.qty > 1 && <Badge variant="secondary">× {item.qty}</Badge>}
                    </label>
                  </li>
                ))}
              </ul>
              {card.exceptions.length > 0 && (
                <p className="text-sm text-amber-700 dark:text-warning">
                  On hold: {card.exceptions.map((e) => `${e.kind.replace("_", " ")}${e.note ? ` – ${e.note}` : ""}`).join("; ")}
                </p>
              )}
              {ready && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setTicked(new Set(itemIds))} disabled={busy !== null}>
                    <CheckIcon /> All present
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setProblemOpen(true)} disabled={busy !== null}>
                    <AlertTriangleIcon /> Report problem
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {ready && (
          <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
            <Button
              type="button"
              size="lg"
              className="h-14 w-full text-base"
              disabled={!confirmable}
              onClick={confirm}
              // A scanner's Enter or an accidental Space must not confirm.
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") e.preventDefault();
              }}
            >
              {busy === "confirm" ? <Loader2Icon className="animate-spin" /> : <PackageCheckIcon />}
              {mode === "pack" ? "Confirm packed" : "Confirm verified"}
              <span className="hidden text-xs font-normal opacity-80 sm:inline">Ctrl+Enter / F9</span>
            </Button>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ right: progress */}
      <div className="space-y-3">
        <Card className="gap-2 py-4">
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">{mode === "pack" ? "Packed" : "Verified"}</span>
              <span className="text-2xl font-semibold tabular-nums">
                {doneCount}
                <span className="text-muted-foreground text-base">/{target}</span>
              </span>
            </div>
            <Bar value={target > 0 ? (doneCount / target) * 100 : 0} aria-label="Progress" />
            <div className="text-muted-foreground grid grid-cols-2 gap-1 text-xs">
              <span>Remaining: {Math.max(target - doneCount, 0)}</span>
              <span>By you: {progress.mine}</span>
              <span>On hold: {progress.onHold}</span>
              <span>No tracking: {progress.total - progress.registered}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="gap-2 py-4">
          <CardContent>
            <p className="mb-2 text-sm font-medium">Recent scans</p>
            {recent.length === 0 ? (
              <p className="text-muted-foreground text-xs">Nothing yet.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {recent.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono">{r.reference}</span>
                    <span
                      className={cn(
                        "shrink-0",
                        r.tone === "success" && "text-success",
                        r.tone === "warning" && "text-amber-700 dark:text-warning",
                        r.tone === "error" && "text-destructive",
                      )}
                    >
                      {r.result} · {r.at}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={problemOpen} onOpenChange={setProblemOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report a problem with {card?.reference}</DialogTitle>
            <DialogDescription>The parcel goes on hold until a planner marks it fixed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Select value={problemKind} onValueChange={setProblemKind}>
              <SelectTrigger className="w-full" aria-label="Problem">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROBLEM_KINDS.map((k) => (
                  <SelectItem key={k.key} value={k.key}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={problemNote} onChange={(e) => setProblemNote(e.target.value)} placeholder="e.g. T06 copies ran out" maxLength={300} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProblemOpen(false)}>
              Cancel
            </Button>
            <Button onClick={report}>Put on hold</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
