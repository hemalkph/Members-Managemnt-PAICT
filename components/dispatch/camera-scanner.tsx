"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOffIcon, Loader2Icon } from "lucide-react";

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (opts: { formats: string[] }) => Detector;

const WASM = "/vendor/zxing/zxing_reader-3.1.3.wasm";

/**
 * Reads Code 128 labels with the phone camera. Uses the browser's own
 * BarcodeDetector when it supports Code 128 (Android Chrome), otherwise the
 * self-hosted WebAssembly reader (iPhone, desktop). Nothing is sent anywhere.
 */
async function makeDetector(): Promise<Detector> {
  const native = (globalThis as unknown as { BarcodeDetector?: DetectorClass & { getSupportedFormats?: () => Promise<string[]> } })
    .BarcodeDetector;
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
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "running" | "error">("starting");
  const [error, setError] = useState("");
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
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the camera here (HTTPS is needed).");
        const detector = await makeDetector();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
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
        setStatus("error");
        setError(
          (e as Error).name === "NotAllowedError"
            ? "Camera permission was refused. Allow the camera for this site, or use a USB scanner."
            : (e as Error).message || "The camera could not start.",
        );
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-lg border bg-black">
      <video ref={video} className="aspect-video w-full object-cover" muted playsInline aria-label="Camera view" />
      {status === "running" && (
        <>
          <div className="pointer-events-none absolute inset-x-6 top-1/2 h-16 -translate-y-1/2 rounded-md border-2 border-white/80" />
          {/* Citypak's small reference barcode has almost no white margin, so cameras read the big top one far better. */}
          <p className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-center text-xs text-white">
            Aim at the big barcode at the top of the label (tracking number)
          </p>
        </>
      )}
      {status === "starting" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
          <Loader2Icon className="size-4 animate-spin" /> Starting camera…
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white">
          <CameraOffIcon className="size-6" />
          <p>{error}</p>
          <button type="button" className="underline" onClick={onClose}>
            Close camera
          </button>
        </div>
      )}
    </div>
  );
}
