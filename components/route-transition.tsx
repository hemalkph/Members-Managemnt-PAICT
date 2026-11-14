"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { isPageChangeCancelled, usePageLoading } from "@/components/route-loading";
import { preloadSticker, Sticker } from "@/components/sticker";

// Links that download a file or leave the app (route handlers) – no overlay.
const SKIP = /^\/(files|auth|papers\/files)\/|\/(pdf|payouts|export)(\/|$)/;

/** Path + query of a URL, so "/work?month=2026-10" and "/work" count as different pages. */
const keyOf = (url: URL) => `${url.pathname}?${url.searchParams.toString()}`;

const MIN_SHOWN_MS = 1200;

/**
 * Page-change animation: when an in-app link is clicked, the page blurs step by
 * step and the waving duck plays in the middle until the next page is ready
 * (including while its loading placeholder shows), then goes as soon as the page
 * is ready. It only appears after ~150 ms and then stays at least ~1.2 s, so
 * fast page changes don't flash.
 */
export function RouteTransition() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = `${pathname}?${searchParams.toString()}`;
  const reduce = useReducedMotion();
  const [loading, setLoading] = useState(false);
  // A page's loading placeholder is on screen (its data is still coming).
  const placeholder = usePageLoading();
  const busy = loading || placeholder;
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);
  const finishing = shown && !busy;
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The new page has arrived: stop waiting for it (state update during render,
  // React's pattern for reacting to a changed value without an effect).
  const [shownFor, setShownFor] = useState(current);
  if (shownFor !== current) {
    setShownFor(current);
    setLoading(false);
  }

  // Show the overlay ~150 ms after a page change starts.
  useEffect(() => {
    if (!busy || shown) return;
    const show = setTimeout(() => {
      shownAt.current = Date.now();
      setShown(true);
    }, 150);
    return () => clearTimeout(show);
  }, [busy, shown]);

  // Page ready: hide now, but not before the duck has been up ~1.2 s (no flash).
  useEffect(() => {
    if (!finishing) return;
    const wait = reduce ? 0 : Math.max(0, MIN_SHOWN_MS - (Date.now() - shownAt.current));
    const hide = setTimeout(() => setShown(false), wait);
    return () => clearTimeout(hide);
  }, [finishing, reduce]);

  // Fetch the duck in the background so the first page change shows it at once.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
    idle(() => preloadSticker("hey"));
  }, []);

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

      // Listened to before the link's own handler: wait a tick so a link that
      // cancels its page change (cancelPageChange, e.g. "you have unsaved changes")
      // shows no overlay. defaultPrevented can't be used: <Link> always sets it.
      setTimeout(() => {
        if (isPageChangeCancelled(event)) return;
        setLoading(true);
        if (timeout.current) clearTimeout(timeout.current);
        // Never get stuck (e.g. the request failed).
        timeout.current = setTimeout(() => setLoading(false), 12_000);
      }, 0);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key="route-transition"
          role="status"
          aria-live="polite"
          aria-label="Loading page"
          className="fixed inset-0 z-[60] flex items-center justify-center"
          // Progressive blur: the page fades and blurs a little more each moment.
          initial={{ backdropFilter: "blur(0px)", backgroundColor: "color-mix(in oklch, var(--background) 0%, transparent)" }}
          animate={{
            backdropFilter: "blur(6px)",
            backgroundColor: "color-mix(in oklch, var(--background) 35%, transparent)",
            transition: { duration: 0.45, ease: "easeOut" },
          }}
          exit={{
            backdropFilter: "blur(0px)",
            backgroundColor: "color-mix(in oklch, var(--background) 0%, transparent)",
            transition: { duration: 0.4, ease: "easeIn" },
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 0.3, delay: 0.1 } }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
          >
            <Sticker name="hey" size={150} loop />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
