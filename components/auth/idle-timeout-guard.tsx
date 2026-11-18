"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { submitSignOut } from "@/lib/auth/client-signout";
import { IDLE_PING_INTERVAL_MS, IDLE_TIMEOUT_MS, IDLE_WARNING_MS } from "@/lib/auth/idle-timeout";

const STORAGE_WRITE_THROTTLE_MS = 5000;
const ACTIVITY_EVENTS: ReadonlyArray<keyof WindowEventMap> = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
  "mousemove",
];

function activityStorageKey(userId: string) {
  return `paict:last-activity:${userId}`;
}

function readSharedActivity(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeSharedActivity(key: string, ts: number) {
  try {
    window.localStorage.setItem(key, String(ts));
  } catch {
    // Private browsing or quota limits: fall back to in-memory timer only.
  }
}

/**
 * Watches user activity across tabs and logs out after 15 minutes of inactivity,
 * showing a 60-second warning dialog beforehand so active work is never interrupted.
 */
export function IdleTimeoutGuard({ userId }: { userId: string }) {
  const storageKey = activityStorageKey(userId);
  const lastActivityRef = useRef<number>(0);
  const lastStorageWriteRef = useRef<number>(0);
  const lastPingRef = useRef<number>(0);
  const signingOutRef = useRef(false);
  const warningOpenRef = useRef(false);

  const [warningSeconds, setWarningSeconds] = useState<number | null>(null);
  const [stayingPending, setStayingPending] = useState(false);

  const triggerSignOut = useCallback(() => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    void submitSignOut("idle");
  }, []);

  const pingServer = useCallback(async () => {
    lastPingRef.current = Date.now();
    try {
      const res = await fetch("/api/auth/keepalive", { method: "POST", credentials: "same-origin" });
      if (res.status === 401) {
        triggerSignOut();
        return false;
      }
      return res.ok;
    } catch {
      return false;
    }
  }, [triggerSignOut]);

  const recordActivity = useCallback(
    (forceStorage = false) => {
      const now = Date.now();
      lastActivityRef.current = now;
      if (forceStorage || now - lastStorageWriteRef.current >= STORAGE_WRITE_THROTTLE_MS) {
        lastStorageWriteRef.current = now;
        writeSharedActivity(storageKey, now);
      }
    },
    [storageKey],
  );

  const stayLoggedIn = useCallback(async () => {
    setStayingPending(true);
    recordActivity(true);
    warningOpenRef.current = false;
    setWarningSeconds(null);
    await pingServer();
    setStayingPending(false);
  }, [pingServer, recordActivity]);

  useEffect(() => {
    const start = Date.now();
    lastActivityRef.current = start;
    lastStorageWriteRef.current = start;
    lastPingRef.current = start;
    writeSharedActivity(storageKey, start);

    const evaluateIdle = () => {
      if (signingOutRef.current) return;
      const now = Date.now();
      const shared = readSharedActivity(storageKey);
      if (shared && shared > lastActivityRef.current) {
        lastActivityRef.current = shared;
        if (warningOpenRef.current && now - shared < IDLE_TIMEOUT_MS - IDLE_WARNING_MS) {
          warningOpenRef.current = false;
          setWarningSeconds(null);
        }
      }

      const elapsed = now - lastActivityRef.current;
      const remaining = IDLE_TIMEOUT_MS - elapsed;

      if (remaining <= 0) {
        triggerSignOut();
        return;
      }

      if (remaining <= IDLE_WARNING_MS) {
        warningOpenRef.current = true;
        setWarningSeconds(Math.max(1, Math.ceil(remaining / 1000)));
        return;
      }

      if (warningOpenRef.current) {
        warningOpenRef.current = false;
        setWarningSeconds(null);
      }

      // Refresh the server activity cookie periodically while the user stays active on one page.
      if (now - lastPingRef.current >= IDLE_PING_INTERVAL_MS && elapsed < IDLE_PING_INTERVAL_MS) {
        void pingServer();
      }
    };

    const onActivity = () => {
      // Once the 60-second warning is visible, require clicking "Stay logged in" rather than stray mouse movement.
      if (warningOpenRef.current || signingOutRef.current) return;
      recordActivity(false);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      const updated = Number(event.newValue);
      if (!Number.isFinite(updated) || updated <= lastActivityRef.current) return;
      lastActivityRef.current = updated;
      if (warningOpenRef.current && Date.now() - updated < IDLE_TIMEOUT_MS - IDLE_WARNING_MS) {
        warningOpenRef.current = false;
        setWarningSeconds(null);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") evaluateIdle();
    };

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onActivity, { passive: true, capture: true });
    }
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(evaluateIdle, 1000);

    return () => {
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, onActivity, { capture: true });
      }
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(interval);
    };
  }, [pingServer, recordActivity, storageKey, triggerSignOut]);

  return (
    <AlertDialog open={warningSeconds !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you still there?</AlertDialogTitle>
          <AlertDialogDescription>
            You have been inactive for a while. For security, you will be automatically logged out in{" "}
            <span className="text-foreground font-semibold tabular-nums">
              {warningSeconds ?? 0} {warningSeconds === 1 ? "second" : "seconds"}
            </span>
            .
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button" onClick={triggerSignOut} disabled={stayingPending}>
            Log out now
          </AlertDialogCancel>
          <AlertDialogAction type="button" onClick={() => void stayLoggedIn()} disabled={stayingPending}>
            Stay logged in
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
