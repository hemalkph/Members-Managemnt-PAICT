"use client";

import { useEffect, useRef } from "react";
import type { AnimationItem } from "lottie-web";
import { cn } from "@/lib/utils";

/** Animated stickers (Lottie JSON files in public/animations). */
export type StickerName = "money-out" | "billion" | "hey" | "flamy" | "press" | "translate";

const loadPlayer = () => import("lottie-web/build/player/lottie_light").then((m) => m.default);

// Each sticker file is downloaded once per visit and shared by every copy on screen.
const files = new Map<StickerName, Promise<unknown>>();
function loadFile(name: StickerName) {
  let file = files.get(name);
  if (!file) {
    file = fetch(`/animations/${name}.json`).then((res) => {
      if (!res.ok) throw new Error(`Sticker ${name} not found`);
      return res.json();
    });
    file.catch(() => files.delete(name)); // try again next time
    files.set(name, file);
  }
  return file;
}

/** Download a sticker and the player in the background, so it shows at once later. */
export function preloadSticker(name: StickerName) {
  void loadPlayer().catch(() => {});
  void loadFile(name).catch(() => {});
}

/**
 * An animated sticker. The player is loaded only when a sticker is needed.
 * With Reduce motion it shows the first frame as a still picture.
 */
export function Sticker({
  name,
  size = 64,
  loop = false,
  onComplete,
  className,
}: {
  name: StickerName;
  size?: number;
  /**
   * Keep playing; otherwise it plays once (3 seconds). Switching it off while
   * playing lets the current play finish, then onComplete runs.
   */
  loop?: boolean;
  /** Runs when a play ends and loop is off. */
  onComplete?: () => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const animation = useRef<AnimationItem | null>(null);
  const loopRef = useRef(loop);
  const completeRef = useRef(onComplete);

  useEffect(() => {
    completeRef.current = onComplete;
  });

  useEffect(() => {
    loopRef.current = loop;
    animation.current?.setLoop(loop);
  }, [loop]);

  useEffect(() => {
    let cancelled = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    Promise.all([loadPlayer(), loadFile(name)])
      .then(([lottie, data]) => {
        if (cancelled || !box.current) return;
        const a = lottie.loadAnimation({
          container: box.current,
          renderer: "svg",
          loop: loopRef.current && !still,
          autoplay: !still,
          // The player changes the data it is given, so each copy gets its own.
          animationData: structuredClone(data),
        });
        if (still) a.goToAndStop(0, true);
        a.addEventListener("complete", () => completeRef.current?.());
        animation.current = a;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      animation.current?.destroy();
      animation.current = null;
    };
  }, [name]);

  return <div ref={box} aria-hidden="true" className={cn("shrink-0", className)} style={{ width: size, height: size }} />;
}
