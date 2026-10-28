"use client";

import { useEffect } from "react";

/** Registers the service worker (needed to install the app and get phone notifications). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Not critical: the site works without it.
    });
  }, []);
  return null;
}
