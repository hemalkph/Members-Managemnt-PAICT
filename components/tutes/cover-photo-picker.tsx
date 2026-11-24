"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon, Loader2Icon, RefreshCwIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { BookletEmblem } from "@/components/tutes/booklet-emblem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { validateCoverFile } from "@/lib/tutes/cover-image";

/**
 * Reusable cover photo picker supporting both uploading an existing image and
 * taking a live photo with the device camera (rear camera on phones, webcam on laptops).
 */
export function CoverPhotoPicker({
  name,
  code,
  coverUrl,
  paperReady,
  busy = false,
  onPickFile,
  onRemove,
}: {
  name: string;
  code: string;
  coverUrl: string | null;
  paperReady?: boolean;
  busy?: boolean;
  onPickFile: (file: File) => void;
  onRemove?: () => void;
}) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const err = validateCoverFile(file);
    if (err) {
      toast.error(err);
      return;
    }
    onPickFile(file);
  };

  const handleTakePhotoClick = () => {
    if (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
      setCameraOpen(true);
    } else {
      captureInputRef.current?.click();
    }
  };

  return (
    <>
      <div className="bg-muted/35 flex items-center gap-3.5 rounded-lg border p-3">
        <BookletEmblem
          name={name || "New tute"}
          code={code}
          coverUrl={coverUrl}
          paperReady={paperReady}
          size="lg"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs font-medium">Cover photo (optional)</p>
          <p className="text-muted-foreground text-[11px]">
            Upload a file or snap a photo of the booklet cover. Auto-resized for fast loading.
          </p>

          <input
            ref={uploadInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {/* Native camera fallback if getUserMedia is unavailable or blocked */}
          <input
            ref={captureInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => uploadInputRef.current?.click()}
            >
              {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
              {coverUrl ? "Upload new" : "Upload photo"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={busy}
              onClick={handleTakePhotoClick}
            >
              <CameraIcon className="size-3.5" />
              Take photo
            </Button>
            {coverUrl && onRemove && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive h-7 text-xs"
                disabled={busy}
                onClick={onRemove}
              >
                <Trash2Icon className="size-3.5" /> Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {cameraOpen && (
        <CameraCaptureDialog
          onClose={() => setCameraOpen(false)}
          onFallbackUpload={() => {
            setCameraOpen(false);
            captureInputRef.current?.click();
          }}
          onCapture={(file) => {
            setCameraOpen(false);
            onPickFile(file);
          }}
        />
      )}
    </>
  );
}

/**
 * Live camera capture modal with a portrait booklet framing guide and rear/front
 * camera switching. Always stops camera tracks immediately on capture or close.
 */
export function CameraCaptureDialog({
  onClose,
  onCapture,
  onFallbackUpload,
}: {
  onClose: () => void;
  onCapture: (file: File) => void;
  onFallbackUpload?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    const start = async () => {
      setReady(false);
      setError(null);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          if (!cancelled) setReady(true);
        }
      } catch {
        if (!cancelled) {
          setError("Could not open the camera. Allow camera access or choose a photo from your device.");
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode]);

  const snap = () => {
    const video = videoRef.current;
    if (!video || !ready || capturing) return;
    setCapturing(true);

    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 960;
    // Crop center portrait booklet ratio (3:4) so snapped covers frame cleanly in the shelf emblem.
    const targetRatio = 3 / 4;
    let sx = 0;
    let sy = 0;
    let sw = vw;
    let sh = vh;
    if (vw / vh > targetRatio) {
      sw = Math.round(vh * targetRatio);
      sx = Math.round((vw - sw) / 2);
    } else {
      sh = Math.round(vw / targetRatio);
      sy = Math.round((vh - sh) / 2);
    }

    const outW = Math.min(sw, 720);
    const outH = Math.round(outW / targetRatio);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCapturing(false);
      toast.error("Could not capture frame.");
      return;
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
    canvas.toBlob(
      (blob) => {
        setCapturing(false);
        if (!blob) {
          toast.error("Could not save camera photo.");
          return;
        }
        const file = new File([blob], `tute-cover-${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
      },
      "image/jpeg",
      0.88,
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Take cover photo</DialogTitle>
          <DialogDescription>Frame the tute cover inside the portrait guide, then snap.</DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="bg-muted/40 space-y-3 rounded-lg border p-4 text-center text-xs">
            <p className="text-muted-foreground">{error}</p>
            {onFallbackUpload && (
              <Button type="button" size="sm" variant="outline" onClick={onFallbackUpload}>
                <UploadIcon className="size-3.5" /> Choose photo instead
              </Button>
            )}
          </div>
        ) : (
          <div className="bg-background relative aspect-[3/4] w-full overflow-hidden rounded-lg border">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="size-full object-cover"
            />
            {!ready && (
              <div className="bg-background/80 absolute inset-0 flex items-center justify-center gap-2 text-xs">
                <Loader2Icon className="size-4 animate-spin" /> Opening camera…
              </div>
            )}
            {/* Subtle portrait booklet crop guide */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-4 rounded-md border border-dashed border-white/50 shadow-[0_0_0_9999px_rgba(0,0,0,0.22)]"
            />
          </div>
        )}

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!ready}
            onClick={() => setFacingMode((m) => (m === "environment" ? "user" : "environment"))}
          >
            <RefreshCwIcon className="size-3.5" /> Flip
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {!error && (
              <Button type="button" size="sm" disabled={!ready || capturing} onClick={snap}>
                {capturing ? <Loader2Icon className="size-3.5 animate-spin" /> : <CameraIcon className="size-3.5" />}
                Snap photo
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
