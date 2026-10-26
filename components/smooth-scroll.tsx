"use client";

import { useEffect } from "react";
import Lenis from "lenis";

/** Scroll areas that should keep their own native scrolling. */
const NATIVE =
  '[role="dialog"], [role="listbox"], [role="menu"], [cmdk-list], [data-slot="sidebar-content"], [data-slot="sheet-content"], [data-lenis-prevent]';

/**
 * Lenis smooth scrolling for the whole page (mouse wheel and trackpad).
 * Phones keep their normal touch scrolling, and people who ask for less
 * motion get normal scrolling too.
 */
export function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({
      autoRaf: true,
      anchors: { offset: -72 },
      allowNestedScroll: true,
      stopInertiaOnNavigate: true,
      respectReducedMotion: true,
      prevent: (node) => Boolean(node.closest?.(NATIVE)),
    });

    // Pop-ups (dialogs, menus) lock the page: pause Lenis while they are open.
    const sync = () => (document.body.hasAttribute("data-scroll-locked") ? lenis.stop() : lenis.start());
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-scroll-locked"] });

    return () => {
      observer.disconnect();
      lenis.destroy();
    };
  }, []);

  return null;
}
