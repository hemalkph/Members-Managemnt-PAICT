"use client";

import { useEffect } from "react";
import { refreshPushSubscriptionAction } from "@/lib/actions/push";

/**
 * Keeps this phone's alerts linked to the current login (alerts are only sent
 * to phones whose login session is still alive). Does nothing if this phone's
 * alerts belong to someone else or were never turned on.
 */
export function PushSessionSync() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("Notification" in window) || Notification.permission !== "granted") return;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) await refreshPushSubscriptionAction({ endpoint: sub.endpoint });
      } catch {
        // Not critical: the next visit tries again.
      }
    })();
  }, []);
  return null;
}
