"use client";

import { useEffect, useState, useTransition } from "react";
import {
  BellOffIcon,
  BellRingIcon,
  CheckCircle2Icon,
  DownloadIcon,
  Loader2Icon,
  SendIcon,
  ShareIcon,
  SmartphoneIcon,
} from "lucide-react";
import { toast } from "sonner";
import ShinyText from "@/components/reactbits/shiny-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { removePushSubscriptionAction, savePushSubscriptionAction, sendTestPushAction } from "@/lib/actions/push";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type State = "loading" | "unsupported" | "ios-install" | "blocked" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua)
    ? "iPhone"
    : /Android/.test(ua)
      ? "Android"
      : /Mac/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return `${os} · ${browser}`;
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

async function registration() {
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

/**
 * Notifications page: install the app on the home screen and turn on phone
 * notifications ("Your turn: Type set (English)" even when the app is closed).
 */
export function PhoneAlertsCard({ vapidKey, devices }: { vapidKey: string | null; devices: number }) {
  const [state, setState] = useState<State>("loading");
  const [installed, setInstalled] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const check = async () => {
      setInstalled(isInstalled());
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        // iPhones only allow notifications for apps added to the home screen.
        setState(isIos() && !isInstalled() ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("blocked");
        return;
      }
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    };
    void check();
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const turnOn = () =>
    startTransition(async () => {
      if (!vapidKey) {
        toast.error("Phone notifications aren't set up on the server yet. Ask a main admin.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        toast.error("Notifications were not allowed.");
        return;
      }
      try {
        const reg = await registration();
        await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          }));
        const json = sub.toJSON();
        const result = await savePushSubscriptionAction({
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
          device: deviceName(),
        });
        if (!result.ok) {
          await sub.unsubscribe();
          toast.error(result.error);
          return;
        }
        setState("on");
        toast.success(result.message);
      } catch {
        toast.error("Could not turn on notifications on this device.");
      }
    });

  const turnOff = () =>
    startTransition(async () => {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
      toast.success("Phone notifications are off on this device");
    });

  const test = () =>
    startTransition(async () => {
      const result = await sendTestPushAction();
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
      setInstallPrompt(null);
    }
  };

  return (
    <Card className="border-primary/30 from-primary/5 gap-4 bg-gradient-to-br to-transparent">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <SmartphoneIcon className="text-primary size-5" /> Alerts on your phone
          {state === "on" && (
            <Badge variant="success">
              <CheckCircle2Icon /> On
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Get “Your turn”, approvals and deadline reminders on this device – even when the app is closed.
          {devices > 0 && ` On for ${devices} device${devices === 1 ? "" : "s"}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Install */}
        {!installed && installPrompt && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
            <p className="text-sm">
              <ShinyText text="Install the app" className="font-semibold" /> – open it from your home screen like any
              app.
            </p>
            <Button size="sm" variant="outline" onClick={install}>
              <DownloadIcon /> Install
            </Button>
          </div>
        )}
        {state === "ios-install" && (
          <div className="space-y-1 rounded-xl border p-3 text-sm">
            <p className="font-semibold">On iPhone, add the app to your home screen first</p>
            <p className="text-muted-foreground flex flex-wrap items-center gap-1">
              In Safari tap <ShareIcon className="inline size-4" /> <b>Share</b> → <b>Add to Home Screen</b>, open the
              app from there, and come back to this page.
            </p>
          </div>
        )}

        {/* Notifications */}
        {state === "loading" && <Loader2Icon className="text-muted-foreground size-5 animate-spin" />}
        {state === "unsupported" && (
          <p className="text-muted-foreground text-sm">
            This browser can&apos;t show notifications. Try Chrome on Android.
          </p>
        )}
        {state === "blocked" && (
          <p className="text-muted-foreground text-sm">
            Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload.
          </p>
        )}
        {(state === "off" || state === "on") && (
          <div className="flex flex-wrap gap-2">
            {state === "off" ? (
              <Button onClick={turnOn} disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" /> : <BellRingIcon />}
                Turn on notifications
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={test} disabled={pending}>
                  {pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                  Send a test
                </Button>
                <Button variant="ghost" onClick={turnOff} disabled={pending}>
                  <BellOffIcon /> Turn off on this device
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
