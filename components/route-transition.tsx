"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BrandLogo } from "@/components/brand-logo";
import { usePageLoading } from "@/components/route-loading";
import ShinyText from "@/components/reactbits/shiny-text";

// Links that download a file or leave the app (route handlers) – no overlay.
const SKIP = /^\/(files|auth|papers\/files)\/|\/(pdf|payouts|export)(\/|$)/;

/** Path + query of a URL, so "/work?month=2026-10" and "/work" count as different pages. */
const keyOf = (url: URL) => `${url.pathname}?${url.searchParams.toString()}`;

/**
 * Page-change animation: when an in-app link is clicked, the page blurs and the
 * class logo pulses inside a spinning ring until the next page's content is
 * ready (including while its loading placeholder shows). It only appears
 * after ~150 ms, so fast navigations don't flash.
 */
export function RouteTransition() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = `${pathname}?${searchParams.toString()}`;
  const reduce = useReducedMotion();
  const [loading, setLoading] = useState(false);
  // A page's loading placeholder is on screen (its data is still coming).
  const placeholder = usePageLoading();
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The new page has arrived: hide the overlay (state update during render,
  // React's pattern for reacting to a changed value without an effect).
  const [shownFor, setShownFor] = useState(current);
  if (shownFor !== current) {
    setShownFor(current);
    setLoading(false);
  }

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a");
      if (!link || !link.href || link.hasAttribute("download")) return;
      if (link.target && link.target !== "_self") return;

      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || SKIP.test(url.pathname)) return;
      const here = new URL(window.location.href);
      if (keyOf(url) === keyOf(here)) return; // same page (or just a #hash)

      setLoading(true);
      if (timeout.current) clearTimeout(timeout.current);
      // Never get stuck (e.g. the request failed).
      timeout.current = setTimeout(() => setLoading(false), 12_000);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);

  return (
    <AnimatePresence>
      {(loading || placeholder) && (
        <motion.div
          key="route-transition"
          role="status"
          aria-live="polite"
          aria-label="Loading page"
          className="bg-background/45 fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.2, delay: 0.15 } }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="relative flex size-28 items-center justify-center">
              {/* Soft glow */}
              <div className="bg-primary/25 absolute inset-2 rounded-full blur-2xl" />
              {/* Spinning gradient ring */}
              <div
                className="absolute inset-0 rounded-full motion-safe:animate-[spin_1.4s_linear_infinite]"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent 0deg, var(--primary) 120deg, var(--chart-2) 220deg, transparent 360deg)",
                  mask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px))",
                  WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px))",
                }}
              />
              {/* Logo card, gently breathing */}
              <motion.div
                className="bg-card/90 relative flex size-20 items-center justify-center rounded-full border shadow-lg"
                animate={reduce ? undefined : { scale: [1, 1.07, 1] }}
                transition={reduce ? undefined : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <BrandLogo className="h-9" priority />
              </motion.div>
            </div>
            <ShinyText text="Loading…" className="text-sm font-medium" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
