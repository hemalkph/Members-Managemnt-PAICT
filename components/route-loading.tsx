"use client";

import { useEffect, useSyncExternalStore } from "react";

// Tiny shared store: how many loading placeholders (loading.tsx) are on screen.
let active = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while a page's loading placeholder is showing. */
export function usePageLoading(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active > 0,
    () => false,
  );
}

/** Put this in loading.tsx: it tells the page-change animation that a page is still loading. */
export function RouteLoadingSignal() {
  useEffect(() => {
    active += 1;
    emit();
    return () => {
      active = Math.max(0, active - 1);
      emit();
    };
  }, []);
  return null;
}
