"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ScanBarcodeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// The browser's own barcode reader (Chrome on Android). Not in TypeScript's DOM types yet.
type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (options?: { formats?: string[] }) => Detector;

const detectorClass = () =>
  typeof window === "undefined" ? undefined : (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;

/** A camera button that reads a Speed Post barcode. Hidden where the browser can't read barcodes. */
export function BarcodeScanButton({ onResult, label }: { onResult: (code: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  // false on the server, the browser's answer after hydration.
  const supported = useSyncExternalStore(
    () => () => {},
    () => Boolean(detectorClass()),
    () => false,
  );
  if (!supported) return null;

  return (
    <>
      <Button type="button" size="icon" variant="outline" className="size-8 shrink-0" aria-label={label} onClick={() => setOpen(true)}>
        <ScanBarcodeIcon />
      </Button>
      {open && (
        <ScanDialog
          onClose={() => setOpen(false)}
          onResult={(code) => {
            setOpen(false);
            onResult(code);
          }}
        />
      )}
    </>
  );
}

function ScanDialog({ onClose, onResult }: { onClose: () => void; onResult: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  // Keep the camera running when the page re-renders.
  const done = useRef(onResult);
  useEffect(() => {
    done.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    const Klass = detectorClass();
    if (!Klass) return;
    const detector = new Klass({ formats: ["code_128", "code_39", "ean_13", "qr_code"] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stopped && video.current) {
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) {
            done.current(found[0].rawValue.trim());
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setError("Couldn't open the camera. Allow camera access, or type the number.");
      }
    })();

    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan the barcode</DialogTitle>
          <DialogDescription>Hold the Speed Post sticker&apos;s barcode inside the frame.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : (
          <video ref={video} className="aspect-[4/3] w-full rounded-lg bg-black object-cover" muted playsInline />
        )}
      </DialogContent>
    </Dialog>
  );
}
