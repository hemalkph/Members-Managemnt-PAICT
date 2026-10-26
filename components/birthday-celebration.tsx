"use client";

import { useEffect, useRef, useState } from "react";
import { PartyPopperIcon } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import BlurText from "@/components/reactbits/blur-text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ordinal } from "@/lib/birthday";

const COLORS = ["#1e6fe8", "#22c3f5", "#0a3fb3", "#f59e0b", "#ec4899", "#22c55e", "#a855f7"];

/** Falling confetti on a full-screen canvas. Stops by itself after a few seconds. */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const w = () => window.innerWidth;
    const pieces = Array.from({ length: 180 }, () => ({
      x: Math.random() * w(),
      y: -20 - Math.random() * window.innerHeight * 0.35,
      size: 6 + Math.random() * 6,
      vx: -1.5 + Math.random() * 3,
      vy: 3 + Math.random() * 3.5,
      rot: Math.random() * Math.PI,
      vr: -0.15 + Math.random() * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      round: Math.random() < 0.3,
    }));

    const start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.globalAlpha = elapsed > 5000 ? Math.max(0, 1 - (elapsed - 5000) / 1500) : 1;
      for (const p of pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.02;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
      }
      if (elapsed < 6500) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-[60] h-full w-full" />;
}

/**
 * Shown to a member on their birthday, once per day (remembered in this browser).
 * With reduced motion there is no confetti, just the greeting.
 */
export function BirthdayCelebration({
  userId,
  firstName,
  age,
  today,
}: {
  userId: string;
  firstName: string;
  age: number;
  today: string;
}) {
  const storageKey = `birthday-shown:${userId}:${today}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(storageKey) === "1";
    } catch {
      // Storage blocked (private mode): just show it.
    }
    if (seen) return;
    const timer = setTimeout(() => setOpen(true), 400);
    return () => clearTimeout(timer);
  }, [storageKey]);

  const close = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // ignore
    }
  };

  return (
    <>
      {open && <Confetti />}
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent className="overflow-hidden text-center sm:max-w-md">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary)_25%,transparent),transparent_70%)]"
          />
          <div className="mx-auto mt-2 text-6xl motion-safe:animate-bounce" aria-hidden>
            🎂
          </div>
          <DialogTitle asChild>
            <div>
              <BlurText
                as="h2"
                text={`Happy Birthday, ${firstName}!`}
                className="text-2xl font-semibold tracking-tight [&>span]:justify-center"
              />
            </div>
          </DialogTitle>
          <DialogDescription className="text-base">
            Wishing you a wonderful {age > 0 ? `${ordinal(age)} ` : ""}birthday from everyone at PA ICT. Thank you for all your
            hard work! 🎉
          </DialogDescription>
          <div className="flex justify-center">
            <BrandLogo className="h-8 opacity-90" />
          </div>
          <Button onClick={close} className="mx-auto w-full sm:w-auto">
            <PartyPopperIcon /> Thank you!
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
