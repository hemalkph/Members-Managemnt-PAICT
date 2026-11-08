"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckCircle2Icon,
  CheckIcon,
  CoffeeIcon,
  ListChecksIcon,
  Loader2Icon,
  LogOutIcon,
  Maximize2Icon,
  Minimize2Icon,
  PackageCheckIcon,
  RotateCcwIcon,
  ScanBarcodeIcon,
  ShieldCheckIcon,
  Undo2Icon,
  UserIcon,
  Volume2Icon,
  VolumeXIcon,
  WifiIcon,
  WifiOffIcon,
  XCircleIcon,
  MegaphoneIcon,
  MegaphoneOffIcon,
} from "lucide-react";
import { AnimateIcon } from "@animate-ui/react/icons";
import { toast } from "sonner";

import { Button as AnimatedButton } from "@/components/animate-ui/components/buttons/button";
import { BarCode, Package, PackageDelivered, SecurityCheck } from "@/components/animate-ui/icons/hugeicons";
import CountUp from "@/components/reactbits/count-up";
import ShinyText from "@/components/reactbits/shiny-text";
import Stepper, { type Step } from "@/components/reactbits/stepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  confirmScanAction,
  lookupScanAction,
  reportProblemAction,
  roundProgressAction,
  undoPackAction,
} from "@/lib/actions/dispatch-packing";
import {
  PROBLEM_KINDS,
  PROBLEM_LABEL,
  type ConfirmResult,
  type LookupResult,
  type ParcelCard,
  type Progress,
  type ScanMode,
} from "@/lib/dispatch/packing";
import { canConfirm, CONFIRM_DELAY_MS, isConfirmShortcut } from "@/lib/dispatch/scanner";
import {
  greeting,
  isMilestone,
  LOOKUP_ADVICE,
  paceMinutes,
  speechText,
  tuteColor,
  workStart,
} from "@/lib/dispatch/station";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { CameraScanner } from "./camera-scanner";
import { useLang, useT } from "./lang";
import { Celebration, SessionSummary, TeamCard, TuteTile } from "./station-parts";
import { TuteCounts } from "./tute-counts";

type Tone = "info" | "success" | "warning" | "error";
type Feedback = { tone: Tone; title: string; detail?: string; note?: string; verifyNext?: string } | null;
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

const UNDO_MS = 10_000;
const BREAK_AFTER_MS = 60 * 60_000;

/** Short sounds (no files): a high beep for success, a low double beep for problems. */
export function beep(ok: boolean) {
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

/** Reads the tutes out loud. Sinhala only when the device has a Sinhala voice. */
function speak(items: { code: string; qty: number }[], lang: "en" | "si") {
  try {
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const si = lang === "si" ? voices.find((v) => v.lang.toLowerCase().startsWith("si")) : undefined;
    const voice = si ?? voices.find((v) => v.lang.toLowerCase().startsWith("en"));
    const utterance = new SpeechSynthesisUtterance(speechText(items, si ? "si" : "en"));
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-US";
    utterance.rate = 0.95;
    synth.cancel();
    synth.speak(utterance);
  } catch {
    // Reading aloud is optional.
  }
}

// Online status and on/off preferences come from the browser, read the React way.
function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
const PREF_EVENT = "dispatch-pref";
function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "on";
  } catch {
    return fallback;
  }
}
function subscribePref(cb: () => void) {
  window.addEventListener(PREF_EVENT, cb);
  return () => window.removeEventListener(PREF_EVENT, cb);
}
function writePref(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(PREF_EVENT));
}
const noSubscribe = () => () => {};

/** Everything in this mode is done (and there was something to do). */
function isFinished(d: Progress, mode: ScanMode): boolean {
  const target = mode === "pack" ? d.registered : d.packed;
  return target > 0 && (mode === "pack" ? d.packed : d.verified) >= target;
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
  userId,
  userName,
  canPack,
  canVerify,
  verificationOn,
  selfVerify,
  initialProgress,
}: {
  roundId: string;
  roundName: string;
  userId: string;
  userName: string;
  canPack: boolean;
  canVerify: boolean;
  verificationOn: boolean;
  /** One-person mode: the packer may verify their own parcels. */
  selfVerify: boolean;
  initialProgress: Progress;
}) {
  const t = useT();
  const lang = useLang();
  const [mode, setMode] = useState<ScanMode>(canPack ? "pack" : "verify");
  const [code, setCode] = useState("");
  const [card, setCard] = useState<ParcelCard | null>(null);
  const [cardKey, setCardKey] = useState("");
  const [openedAt, setOpenedAt] = useState(0);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"lookup" | "confirm" | "undo" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [retry, setRetry] = useState(false);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [progress, setProgress] = useState(initialProgress);
  const [camera, setCamera] = useState(false);
  const sound = useSyncExternalStore(subscribePref, () => readPref("dispatch-sound", true), () => true);
  const readAloud = useSyncExternalStore(subscribePref, () => readPref("dispatch-speak", false), () => false);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const hour = useSyncExternalStore(noSubscribe, () => new Date().getHours(), () => null);
  const [now, setNow] = useState(0);
  const [clock, setClock] = useState(0);
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemKind, setProblemKind] = useState<string>("missing_item");
  const [problemNote, setProblemNote] = useState("");
  // This session: my confirm times, counts, the undo window, celebrations.
  const [myTimes, setMyTimes] = useState<number[]>([]);
  const [session, setSession] = useState({ packed: 0, verified: 0, problems: 0 });
  const [undoable, setUndoable] = useState<{ id: string; reference: string; until: number } | null>(null);
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [breakSnoozedUntil, setBreakSnoozedUntil] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  const finishedRef = useRef<boolean | null>(isFinished(initialProgress, mode));
  const device = useMemo(() => (typeof window === "undefined" ? "browser" : deviceId()), []);

  const firstName = userName.split(" ")[0] || userName;
  const focusScan = useCallback(() => setTimeout(() => input.current?.focus(), 0), []);
  const itemIds = useMemo(() => card?.items.map((i) => i.id) ?? [], [card]);
  const tuteCodes = useMemo(() => progress.tutes.map((x) => x.code), [progress.tutes]);
  const ready = card !== null && cardKey !== "";
  const allTicked = ready && itemIds.length > 0 && itemIds.every((id) => ticked.has(id));
  const confirmable = ready && canConfirm({ itemIds, ticked, openedAt, now, pending: busy !== null });
  const soloVerify = selfVerify && canPack && canVerify && verificationOn;
  // Team tools only when a second person checks every parcel.
  const teamMode = verificationOn && !selfVerify;

  // ------------------------------------------------------------------ live progress
  const refreshProgress = useCallback(async () => {
    const result = await roundProgressAction({ round_id: roundId });
    if (!result.ok || !result.data) return;
    const d = result.data;
    setProgress(d);
    const finished = isFinished(d, modeRef.current);
    if (finished && finishedRef.current === false) setCelebrate("All done for this round!");
    finishedRef.current = finished;
  }, [roundId]);

  useEffect(() => {
    modeRef.current = mode;
    finishedRef.current = null; // the next refresh sets the baseline for this mode
  }, [mode]);

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`parcels-${roundId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "parcels", filter: `round_id=eq.${roundId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(refreshProgress, 500);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [roundId, refreshProgress]);

  // ------------------------------------------------------------------ clocks
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setNow(Date.now()), CONFIRM_DELAY_MS + 20);
    return () => clearTimeout(timer);
  }, [ready, openedAt]);

  // Every second while Undo is offered, otherwise every 30 s (team "active" dots, break reminder).
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, undoable ? 1000 : 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [undoable]);

  // Leaving full screen with Esc also leaves the focus layout.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFocusMode(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const say = useCallback(
    (f: Feedback, ok?: boolean) => {
      // Titles and details are English keys (or already translated text); show them in the chosen language.
      setFeedback(
        f && {
          ...f,
          title: t(f.title),
          detail: f.detail === undefined ? undefined : t(f.detail),
          note: f.note === undefined ? undefined : t(f.note),
        },
      );
      if (sound && ok !== undefined) beep(ok);
    },
    [sound, t],
  );

  const addRecent = (reference: string, result: string, tone: Tone) =>
    setRecent((list) => [{ reference, result, tone, at: new Date().toLocaleTimeString() }, ...list].slice(0, 12));

  // ------------------------------------------------------------------ 1. look up (the only thing Enter does)
  const lookup = useCallback(
    async (raw: string, as: ScanMode = mode) => {
      const scanned = raw.trim();
      if (!scanned || busy) return;
      setCode("");
      const unconfirmed = ready ? card?.reference : null;
      setBusy("lookup");
      setRetry(false);
      try {
        const result = await lookupScanAction({ round_id: roundId, code: scanned, mode: as, device });
        if (!result.ok) {
          say({ tone: "error", title: "Lookup failed", detail: result.error }, false);
          return;
        }
        const r = result.data!;
        const notice =
          unconfirmed && unconfirmed !== r.card?.reference
            ? t("({ref} was not confirmed – it is unchanged)", { ref: unconfirmed })
            : undefined;
        if (r.result === "ready" && r.card) {
          setCard(r.card);
          setTicked(new Set());
          setCardKey(crypto.randomUUID());
          const opened = Date.now();
          setOpenedAt(opened);
          setNow(opened);
          setFeedback(notice ? { tone: "warning", title: notice } : null);
          if (readAloud) speak(r.card.items, lang);
        } else {
          setCard(r.card ?? null);
          setCardKey("");
          const advice = r.result === "ready" ? LOOKUP_ADVICE.unknown : LOOKUP_ADVICE[r.result];
          const owner = r.result === "not_assigned" ? r.card?.assigned_name : null;
          say(
            {
              tone: LOOKUP_TONE[r.result],
              title: advice.title,
              detail: owner ? t("Pass it to {name}.", { name: owner }) : advice.hint,
              note: [
                r.message ? t(r.message) : "",
                r.result === "unknown" || r.result === "wrong_round" ? t("Scanned: {code}", { code: r.code ?? scanned }) : "",
                notice ?? "",
              ]
                .filter(Boolean)
                .join(" "),
            },
            false,
          );
          addRecent(r.card?.reference ?? r.code ?? scanned, advice.title, LOOKUP_TONE[r.result]);
        }
      } catch {
        say({ tone: "error", title: "Not connected", detail: "The lookup didn't reach the server. Scan again." }, false);
      } finally {
        setBusy(null);
        focusScan();
      }
    },
    [busy, card, device, focusScan, lang, mode, readAloud, ready, roundId, say, t],
  );

  // ------------------------------------------------------------------ 3. confirm (button, Ctrl+Enter or F9 – never plain Enter)
  const confirm = useCallback(async () => {
    if (!card || !confirmable) return;
    setBusy("confirm");
    setFeedback({ tone: "info", title: t("Saving…"), detail: card.reference });
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
        say(
          {
            tone: "success",
            title: r.message,
            detail: r.replayed ? "Already saved earlier – nothing changed." : "Saved. Scan the next parcel.",
            // One-person mode: offer the second check straight away.
            verifyNext: mode === "pack" && soloVerify ? card.reference : undefined,
          },
          true,
        );
        addRecent(card.reference, mode === "pack" ? "Packed" : "Verified", "success");
        if (!r.replayed) {
          const at = Date.now();
          setMyTimes((list) => [...list, at]);
          const key = mode === "pack" ? "packed" : "verified";
          const count = session[key] + 1;
          setSession((s) => ({ ...s, [key]: count }));
          if (isMilestone(count)) setCelebrate(t("{n} parcels – great work!", { n: count }));
          if (mode === "pack") setUndoable({ id: card.id, reference: card.reference, until: at + UNDO_MS });
        }
        setCard(null);
        setCardKey("");
        refreshProgress();
      } else {
        say(
          {
            tone: r.result === "items" ? "warning" : "error",
            title: r.result === "changed" ? "Changed meanwhile" : "Not saved",
            detail: r.message,
          },
          false,
        );
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
  }, [card, cardKey, confirmable, device, focusScan, mode, refreshProgress, roundId, say, session, soloVerify, t, ticked]);

  const undo = async () => {
    if (!undoable || busy) return;
    const { id, reference } = undoable;
    setBusy("undo");
    const result = await undoPackAction({ parcel_id: id, round_id: roundId });
    setBusy(null);
    setUndoable(null);
    if (!result.ok) {
      say({ tone: "error", title: "Couldn't undo", detail: result.error }, false);
      return;
    }
    setMyTimes((list) => list.slice(0, -1));
    setSession((s) => ({ ...s, packed: Math.max(s.packed - 1, 0) }));
    say({ tone: "info", title: t("{ref} is back to pack", { ref: reference }), detail: "Scan it again when you are ready." });
    addRecent(reference, "Undone", "warning");
    refreshProgress();
    focusScan();
  };

  const verifyNow = (reference: string) => {
    setMode("verify");
    lookup(reference, "verify");
  };

  // Keys: Ctrl+Enter / F9 confirm. Typing anywhere goes into the scan box (scanners type fast).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (problemOpen || summaryOpen) return;
      if (isConfirmShortcut(e)) {
        e.preventDefault();
        confirm();
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (!typing && e.key?.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, problemOpen, summaryOpen]);

  const report = async () => {
    if (!card) return;
    const result = await reportProblemAction({ parcel_id: card.id, kind: problemKind, note: problemNote });
    setProblemOpen(false);
    setProblemNote("");
    if (!result.ok) return void toast.error(t(result.error));
    setSession((s) => ({ ...s, problems: s.problems + 1 }));
    say(
      {
        tone: "warning",
        title: t("{ref} is on hold", { ref: card.reference }),
        detail: "Thanks for flagging it. A planner will sort it out – scan the next parcel.",
      },
      false,
    );
    setCard(null);
    setCardKey("");
    refreshProgress();
    focusScan();
  };

  const toggleFocus = async () => {
    if (focusMode) {
      setFocusMode(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      return;
    }
    setFocusMode(true);
    await wrapper.current?.requestFullscreen?.().catch(() => {});
  };

  const doneCount = mode === "pack" ? progress.packed : progress.verified;
  const target = mode === "pack" ? progress.registered : progress.packed;
  const remaining = Math.max(target - doneCount, 0);
  const pace = paceMinutes(myTimes, remaining);
  const started = workStart(myTimes);
  const lastConfirm = myTimes.at(-1) ?? 0;
  const needsBreak =
    started !== null && clock - started > BREAK_AFTER_MS && clock - lastConfirm < 10 * 60_000 && clock > breakSnoozedUntil;
  const undoLeft = undoable ? Math.ceil((undoable.until - clock) / 1000) : 0;

  // The coach: one clear next step.
  const step = !ready ? 1 : allTicked ? 3 : 2;
  const tickedCount = itemIds.filter((id) => ticked.has(id)).length;
  const coach =
    step === 1
      ? mode === "pack"
        ? t("Scan the next label")
        : t("Scan a packed parcel to check it")
      : step === 2
        ? mode === "pack"
          ? t(itemIds.length === 1 ? "Put in this tute" : "Put in these {n} tutes", { n: itemIds.length })
          : t("Check the {n} tutes inside", { n: itemIds.length })
        : mode === "pack"
          ? t("All in – press Confirm")
          : t("All there – press Confirm");
  const steps: Step[] = [
    { key: "scan", label: t("Scan"), state: step > 1 ? "done" : "active" },
    { key: "tutes", label: t("Tutes"), state: step > 2 ? "done" : step === 2 ? "active" : "waiting" },
    { key: "confirm", label: t("Confirm"), state: step === 3 ? "active" : "waiting" },
  ];
  const StepIcon = step === 1 ? BarCode : step === 2 ? Package : mode === "pack" ? PackageDelivered : SecurityCheck;
  const tone = feedback ? TONE[feedback.tone] : TONE.info;
  const ToneIcon = tone.icon;

  return (
    <div
      ref={wrapper}
      className={cn("space-y-4", focusMode && "bg-background fixed inset-0 z-50 overflow-y-auto p-4 sm:p-6")}
    >
      {/* ------------------------------------------------------------ greeting and tools */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 shadow-xs sm:p-4">
        <div className="min-w-0 space-y-0.5">
          <p className="text-lg font-semibold sm:text-xl">
            <ShinyText text={`${hour === null ? t("Hello") : t(greeting(hour))}, ${firstName}`} />{" "}
            <span aria-hidden>👋</span>
          </p>
          <p className="text-muted-foreground text-sm">
            {t("{n} done by you in this round", { n: progress.mine })}
            {" · "}
            {pace !== null
              ? t("About {left} left – around {min} min at your pace", { left: remaining, min: pace })
              : t("{n} left", { n: remaining })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn("inline-flex items-center gap-1 px-1 text-xs", online ? "text-success" : "text-destructive")}
            role="status"
          >
            {online ? <WifiIcon className="size-3.5" /> : <WifiOffIcon className="size-3.5" />}
            {online ? t("Online") : t("Offline")}
          </span>
          <Button type="button" variant="ghost" size="sm" aria-pressed={sound} onClick={() => writePref("dispatch-sound", !sound)}>
            {sound ? <Volume2Icon /> : <VolumeXIcon />} {t("Sound")}
          </Button>
          <Button
            type="button"
            variant={readAloud ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={readAloud}
            onClick={() => writePref("dispatch-speak", !readAloud)}
          >
            {readAloud ? <MegaphoneIcon /> : <MegaphoneOffIcon />} {t("Read aloud")}
          </Button>
          <Button type="button" variant="ghost" size="sm" aria-pressed={focusMode} onClick={toggleFocus}>
            {focusMode ? <Minimize2Icon /> : <Maximize2Icon />} {focusMode ? t("Exit full screen") : t("Full screen")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setSummaryOpen(true)}>
            <LogOutIcon /> {t("Finish for now")}
          </Button>
        </div>
      </div>

      {needsBreak && (
        <div className="bg-chart-2/10 flex flex-wrap items-center gap-3 rounded-xl border p-3" role="status">
          <CoffeeIcon className="text-chart-2 size-5 shrink-0" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{t("You've been packing for an hour.")}</span>{" "}
            {t("Stretch, drink some water and rest your eyes for a few minutes.")}
          </p>
          <Button size="sm" variant="outline" onClick={() => setBreakSnoozedUntil(clock + 30 * 60_000)}>
            {t("Thanks, later")}
          </Button>
        </div>
      )}

      <div className="grid gap-4 pb-24 lg:grid-cols-[280px_minmax(0,1fr)_280px] lg:pb-0">
        {/* ------------------------------------------------------------ left: input */}
        <div className="space-y-3">
          <p className="text-muted-foreground truncate text-xs">{roundName}</p>
          {soloVerify && (
            <p className="bg-primary/5 text-primary flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium">
              <UserIcon className="size-3.5" /> {t("One-person mode: you pack and verify")}
            </p>
          )}
          {canPack && canVerify && verificationOn && (
            <div className="grid grid-cols-2 gap-1 rounded-lg border p-1 shadow-xs" role="radiogroup" aria-label={t("Mode")}>
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
                    setUndoable(null);
                    focusScan();
                  }}
                >
                  {m === "pack" ? t("Pack") : t("Verify")}
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
            <Label htmlFor="scan-code">{t("Scan or type a label")}</Label>
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
              placeholder={t("D16950069 or reference")}
              className={cn("font-mono", focusMode ? "h-14 text-xl" : "h-12 text-lg")}
              disabled={!online}
            />
            <p className="text-muted-foreground text-xs">{t("Enter only looks the parcel up. It never confirms.")}</p>
          </form>
          <Button type="button" variant={camera ? "default" : "outline"} size="sm" onClick={() => setCamera((c) => !c)}>
            <CameraIcon /> {camera ? t("Close camera") : t("Camera")}
          </Button>
          {camera && <CameraScanner onCode={(c) => lookup(c)} onClose={() => setCamera(false)} />}

          {teamMode && mode === "pack" && progress.queue.length > 0 && (
            <Card className="gap-2 py-4">
              <CardContent className="space-y-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <ListChecksIcon className="size-4" /> {t("Your list")}
                  <Badge variant="secondary" className="ml-auto">
                    {progress.queue.length}
                  </Badge>
                </p>
                <p className="text-muted-foreground text-xs">{t("Parcels assigned to you. Tap one to open it.")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {progress.queue.slice(0, 12).map((ref) => (
                    <Button
                      key={ref}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 font-mono text-xs"
                      disabled={busy !== null}
                      onClick={() => lookup(ref)}
                    >
                      {ref}
                    </Button>
                  ))}
                  {progress.queue.length > 12 && (
                    <span className="text-muted-foreground self-center text-xs">
                      {t("+{n} more", { n: progress.queue.length - 12 })}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ------------------------------------------------------------ centre: the next step and the parcel */}
        <div className="space-y-3">
          <div className="bg-card space-y-3 rounded-xl border p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <AnimateIcon
                key={`${step}-${mode}`}
                animateOnView
                className="bg-primary/10 text-primary flex size-12 shrink-0 items-center justify-center rounded-xl"
              >
                <StepIcon className="size-6" />
              </AnimateIcon>
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs font-medium">{t("Step {n} of 3", { n: step })}</p>
                <p className={cn("leading-tight font-semibold", focusMode ? "text-3xl" : "text-2xl")} aria-live="polite">
                  {coach}
                </p>
                {step === 2 && (
                  <p className="text-muted-foreground text-sm">{t("{done} of {n} ticked", { done: tickedCount, n: itemIds.length })}</p>
                )}
              </div>
            </div>
            <Stepper steps={steps} compact />
          </div>

          {(feedback || busy) && (
            <div
              className={cn("flex gap-3 rounded-lg border-2 p-3 shadow-sm transition-colors duration-300", tone.box)}
              role="status"
              aria-live="assertive"
            >
              {busy ? <Loader2Icon className="mt-0.5 size-5 shrink-0 animate-spin" /> : <ToneIcon className="mt-0.5 size-5 shrink-0" />}
              <div className="min-w-0 flex-1">
                {feedback && (
                  <>
                    <p className="font-semibold">{feedback.title}</p>
                    {feedback.detail && <p className="text-sm">{feedback.detail}</p>}
                    {feedback.note && <p className="text-muted-foreground mt-0.5 text-xs">{feedback.note}</p>}
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  {retry && card && (
                    <Button size="sm" className="mt-2" onClick={confirm}>
                      <RotateCcwIcon /> {t("Retry")}
                    </Button>
                  )}
                  {undoable && undoLeft > 0 && (
                    <Button size="sm" variant="outline" className="mt-2" disabled={busy !== null} onClick={undo}>
                      <Undo2Icon /> {t("Undo ({s}s)", { s: undoLeft })}
                    </Button>
                  )}
                  {feedback?.verifyNext && !busy && (
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => verifyNow(feedback.verifyNext!)}>
                      <ShieldCheckIcon /> {t("Verify {ref} now", { ref: feedback.verifyNext })}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {card && (
            <Card className="animate-in fade-in-0 slide-in-from-bottom-2 gap-3 shadow-md duration-200">
              <CardHeader>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <CardTitle className="font-mono text-2xl tracking-tight sm:text-3xl">{card.reference}</CardTitle>
                  <span className="text-muted-foreground font-mono text-sm">{card.tracking_no ?? t("no tracking")}</span>
                </div>
                <p className="text-muted-foreground text-sm">
                  {t("Student")} <span className="text-foreground font-mono font-semibold">{card.student_no}</span>
                  {card.assigned_name ? ` · ${t("assigned to {name}", { name: card.assigned_name })}` : ""}
                  {card.packed_name ? ` · ${t("packed by {name}", { name: card.packed_name })}` : ""}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className={cn("grid gap-2", card.items.length > 1 && "sm:grid-cols-2")} aria-label={t("Tutes in this parcel")}>
                  {card.items.map((item) => (
                    <li key={item.id}>
                      <TuteTile
                        code={item.code}
                        title={item.title}
                        qty={item.qty}
                        color={tuteColor(item.code, tuteCodes)}
                        ticked={ticked.has(item.id)}
                        disabled={!ready || busy !== null}
                        large={focusMode}
                        onToggle={() =>
                          setTicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          })
                        }
                      />
                    </li>
                  ))}
                </ul>
                {card.exceptions.length > 0 && (
                  <p className="text-sm text-amber-700 dark:text-warning">
                    {t("On hold:")}{" "}
                    {card.exceptions
                      .map((e) => `${t(PROBLEM_LABEL[e.kind] ?? e.kind.replace("_", " "))}${e.note ? ` – ${e.note}` : ""}`)
                      .join("; ")}
                  </p>
                )}
                {ready && (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setTicked(new Set(itemIds))} disabled={busy !== null}>
                      <CheckIcon /> {t("All present")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setProblemOpen(true)} disabled={busy !== null}>
                      <AlertTriangleIcon /> {t("Report problem")}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {ready && (
            <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
              <AnimatedButton
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
                {mode === "pack" ? t("Confirm packed") : t("Confirm verified")}
                <span className="hidden text-xs font-normal opacity-80 sm:inline">{t("Ctrl+Enter / F9")}</span>
              </AnimatedButton>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------ right: progress and team */}
        <div className="space-y-3">
          <Card className="gap-2 py-4">
            <CardContent className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">{mode === "pack" ? t("Packed") : t("Verified")}</span>
                <span className="text-2xl font-semibold tabular-nums">
                  <CountUp key={doneCount} from={Math.max(doneCount - 1, 0)} to={doneCount} duration={0.5} />
                  <span className="text-muted-foreground text-base">/{target}</span>
                </span>
              </div>
              <Bar value={target > 0 ? (doneCount / target) * 100 : 0} aria-label={t("Progress")} />
              <div className="text-muted-foreground grid grid-cols-2 gap-1 text-xs">
                <span>
                  {t("Remaining:")} {remaining}
                </span>
                <span>{t("By you: {mine}", { mine: progress.mine })}</span>
                <span>{t("On hold: {onHold}", { onHold: progress.onHold })}</span>
                <span>
                  {t("No tracking:")} {progress.total - progress.registered}
                </span>
              </div>
            </CardContent>
          </Card>
          {teamMode && <TeamCard team={progress.team} meId={userId} now={clock} />}
          <TuteCounts
            tutes={progress.tutes}
            parcels={progress.total}
            packed={progress.packed}
            colorOf={(c) => tuteColor(c, tuteCodes).dot}
          />
          <Card className="gap-2 py-4">
            <CardContent>
              <p className="mb-2 text-sm font-medium">{t("Recent scans")}</p>
              {recent.length === 0 ? (
                <p className="text-muted-foreground text-xs">{t("Nothing yet.")}</p>
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
                        {t(r.result)} · {r.at}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={problemOpen} onOpenChange={setProblemOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("What's wrong with {reference}?", { reference: card?.reference })}</DialogTitle>
            <DialogDescription>{t("The parcel goes on hold until a planner marks it fixed.")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Problem")}>
              {PROBLEM_KINDS.map((k) => (
                <Button
                  key={k.key}
                  type="button"
                  role="radio"
                  aria-checked={problemKind === k.key}
                  variant={problemKind === k.key ? "default" : "outline"}
                  className="h-auto min-h-11 justify-start whitespace-normal text-left"
                  onClick={() => setProblemKind(k.key)}
                >
                  {t(k.label)}
                </Button>
              ))}
            </div>
            <Input
              value={problemNote}
              onChange={(e) => setProblemNote(e.target.value)}
              placeholder={t("Add a note (optional), e.g. T06 copies ran out")}
              maxLength={300}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProblemOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={report}>{t("Put on hold")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SessionSummary
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        firstName={firstName}
        stats={{
          packed: session.packed,
          verified: session.verified,
          problems: session.problems,
          minutes: myTimes.length > 0 ? Math.max(1, Math.round(((myTimes.at(-1) ?? 0) - myTimes[0]) / 60_000)) : 0,
        }}
      />

      {celebrate && <Celebration message={t(celebrate)} onDone={() => setCelebrate(null)} />}
    </div>
  );
}
