"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckIcon, CompassIcon, RocketIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { OPEN_GUIDE_EVENT } from "./welcome-guide";

export type SetupStep = { key: string; label: string; hint: string; href: string; done: boolean };

const hiddenKey = (userId: string) => `getting-started-hidden:${userId}`;

/** Dashboard checklist for new members; it ticks itself off and disappears when everything is done. */
export function GettingStarted({ userId, steps }: { userId: string; steps: SetupStep[] }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this device
      setHidden(window.localStorage.getItem(hiddenKey(userId)) === "1");
    } catch {
      setHidden(false);
    }
  }, [userId]);

  const done = steps.filter((s) => s.done).length;
  if (hidden || done === steps.length) return null;

  const hide = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(hiddenKey(userId), "1");
    } catch {
      // ignore
    }
  };

  return (
    <Card className="border-primary/30 from-primary/5 gap-3 bg-gradient-to-br to-transparent">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <RocketIcon className="text-primary size-5" /> Getting started
          </CardTitle>
          <CardDescription>
            {done} of {steps.length} done – finish these so you get your tasks, alerts and payments.
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" className="-mt-1 -mr-2 shrink-0" aria-label="Hide this list" onClick={hide}>
          <XIcon />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress
          value={(done / steps.length) * 100}
          aria-label={`${done} of ${steps.length} done`}
          className="h-1.5"
        />
        <ul className="grid gap-2 sm:grid-cols-2">
          {steps.map((s) => (
            <li key={s.key}>
              <Link
                href={s.href}
                className={cn(
                  "hover:bg-accent/50 flex items-center gap-3 rounded-lg border p-2.5 transition-colors",
                  s.done && "opacity-60",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border-2",
                    s.done ? "bg-success border-success text-white" : "border-primary/40",
                  )}
                >
                  {s.done && <CheckIcon className="size-3.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm font-medium", s.done && "line-through")}>{s.label}</span>
                  <span className="text-muted-foreground block truncate text-xs">{s.hint}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new Event(OPEN_GUIDE_EVENT))}>
          <CompassIcon /> Open the quick guide
        </Button>
      </CardContent>
    </Card>
  );
}
