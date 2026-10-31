"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOffIcon, Loader2Icon, RotateCwIcon } from "lucide-react";

import { useT } from "@/components/dispatch/lang";
type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (opts: { formats: string[] }) => Detector;

const WASM = "/vendor/zxing/zxing_reader-3.1.3.wasm";

/**
 * Reads Code 128 labels with the phone camera. Uses the browser's own
 * BarcodeDetector when it supports Code 128 (Android Chrome), otherwise the
 * self-hosted WebAssembly reader (iPhone, desktop). Nothing is sent anywhere.
 */
async function makeDetector(): Promise<Detector> {
  const native = (
    globalThis as unknown as { BarcodeDetector?: DetectorClass & { getSupportedFormats?: () => Promise<string[]> } }
  ).BarcodeDetector;
  if (native?.getSupportedFormats) {
    const formats = await native.getSupportedFormats();
    if (formats.includes("code_128")) return new native({ formats: ["code_128"] });
  }
  const mod = await import("barcode-detector/ponyfill");
  mod.setZXingModuleOverrides({
    locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? WASM : prefix + path),
  });
  return new (mod.BarcodeDetector as unknown as DetectorClass)({ formats: ["code_128"] });
}

export function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "running" | "error">("starting");
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("This browser can't use the camera here (HTTPS is needed).");
        // Ask for the camera first, so the phone shows its "Allow camera?" question
        // straight after the tap; the barcode reader loads afterwards.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const detector = await makeDetector();
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        setStatus("running");
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            const code = found[0]?.rawValue?.trim();
            const now = Date.now();
            // The same label stays in view for a while: report it once every 2.5 seconds at most.
            if (code && (code !== last.current.code || now - last.current.at > 2500)) {
              last.current = { code, at: now };
              onCodeRef.current(code);
            }
          } catch {
            // A frame that can't be read is normal; keep going.
          }
          timer = setTimeout(tick, 200);
        };
        tick();
      } catch (e) {
        if (stopped) return;
        const name = (e as Error).name;
        setStatus("error");
        setBlocked(name === "NotAllowedError" || name === "SecurityError");
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "The camera is not allowed yet."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No camera was found on this device."
              : name === "NotReadableError"
                ? "Another app is using the camera. Close it and try again."
                : (e as Error).message || "The camera could not start.",
        );
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [attempt]);

  function retry() {
    setStatus("starting");
    setError("");
    setBlocked(false);
    setAttempt((n) => n + 1);
  }

  return (
    <div className="relative overflow-hidden rounded-lg border bg-black">
      <video ref={video} className="aspect-video w-full object-cover" muted playsInline aria-label={t("Camera view")} />
      {status === "running" && (
        <>
          <div className="pointer-events-none absolute inset-x-6 top-1/2 h-16 -translate-y-1/2 rounded-md border-2 border-white/80" />
          {/* Citypak's small reference barcode has almost no white margin, so cameras read the big top one far better. */}
          <p className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-center text-xs text-white">
            {t("Aim at the big barcode at the top of the label (tracking number)")}
          </p>
        </>
      )}
      {status === "starting" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
          <Loader2Icon className="size-4 animate-spin" /> {t("Starting camera…")}
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white">
          <CameraOffIcon className="size-6" />
          <p className="font-medium">{t(error)}</p>
          {blocked && (
            <div className="max-w-sm space-y-1 text-xs text-white/80">
              <p>{t("Tap Try again and choose Allow when the phone asks.")}</p>
              <p>{t("If it doesn't ask: tap the icon next to the web address, set Camera to Allow, then tap Try again.")}</p>
              <p>{t("iPhone: Settings → Safari → Camera → Allow.")}</p>
            </div>
          )}
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 font-medium text-black"
              onClick={retry}
            >
              <RotateCwIcon className="size-4" /> {t("Try again")}
            </button>
            <button type="button" className="underline" onClick={onClose}>
              {t("Close camera")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
