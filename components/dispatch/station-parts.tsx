"use client";

import { useEffect, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckIcon, HeartHandshakeIcon, UsersIcon } from "lucide-react";
import { AnimateIcon } from "@animate-ui/react/icons";

import { Button } from "@/components/animate-ui/components/buttons/button";
import { PackageDelivered } from "@/components/animate-ui/icons/hugeicons";
import AnimatedList from "@/components/reactbits/animated-list";
import CountUp from "@/components/reactbits/count-up";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Progress } from "@/lib/dispatch/packing";
import { TUTE_COLORS } from "@/lib/dispatch/station";
import { cn } from "@/lib/utils";
import { useT } from "./lang";

/** One tute in the parcel: a big coloured tile; tap anywhere to tick it. */
export function TuteTile({
  code,
  title,
  qty,
  color,
  ticked,
  disabled,
  large,
  onToggle,
}: {
  code: string;
  title: string;
  qty: number;
  color: (typeof TUTE_COLORS)[number];
  ticked: boolean;
  disabled: boolean;
  large: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      aria-pressed={ticked}
      disabled={disabled}
      onClick={onToggle}
      whileTap={reduce || disabled ? undefined : { scale: 0.97 }}
      className={cn(
        "relative flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition-[opacity,box-shadow] disabled:cursor-default",
        color.tile,
        ticked && "ring-success ring-offset-background ring-2 ring-offset-2",
        !ticked && !disabled && "hover:shadow-md",
        disabled && "opacity-70",
        large ? "min-h-24 p-4" : "min-h-20",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          large ? "size-10" : "size-8",
          ticked ? "bg-success border-success text-white" : "border-current/30 bg-background/60",
        )}
        aria-hidden
      >
        <AnimatePresence>
          {ticked && (
            <motion.span initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
              <CheckIcon className={large ? "size-6" : "size-5"} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block font-mono font-bold tracking-tight", large ? "text-3xl" : "text-2xl")}>{code}</span>
        <span className={cn("block truncate opacity-80", large ? "text-base" : "text-sm")}>{title}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className={cn("block font-bold tabular-nums", large ? "text-4xl" : "text-3xl")}>×{qty}</span>
        <span className="block text-xs opacity-70">{qty === 1 ? t("copy") : t("copies")}</span>
      </span>
    </motion.button>
  );
}

const BURST = ["bg-sky-500", "bg-amber-400", "bg-emerald-500", "bg-rose-500", "bg-violet-500", "bg-orange-400"];

/** A short burst of colour and a message. With reduced motion, only the message. */
export function Celebration({ message, onDone }: { message: string; onDone: () => void }) {
  const reduce = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        const angle = (i / 28) * Math.PI * 2;
        const dist = 140 + ((i * 37) % 120);
        return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist - 40, color: BURST[i % BURST.length], rotate: (i * 47) % 360 };
      }),
    [],
  );
  useEffect(() => {
    const timer = setTimeout(onDone, 2600);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center" role="status" aria-live="polite">
      {!reduce &&
        pieces.map((p, i) => (
          <motion.span
            key={i}
            className={cn("absolute size-2.5 rounded-sm", p.color)}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
            animate={{ x: p.x, y: p.y + 160, opacity: 0, rotate: p.rotate + 180, scale: 1 }}
            transition={{ duration: 1.8, ease: "easeOut" }}
          />
        ))}
      <motion.div
        initial={reduce ? false : { scale: 0.8, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        className="bg-background/95 rounded-2xl border px-6 py-4 text-center shadow-xl"
      >
        <p className="text-2xl font-semibold">{message}</p>
      </motion.div>
    </div>
  );
}

const ACTIVE_MS = 10 * 60_000;

/** Who is packing / verifying in this round, with their counts. */
export function TeamCard({ team, meId, now }: { team: Progress["team"]; meId: string; now: number }) {
  const t = useT();
  if (team.length === 0) return null;
  const active = team.filter((p) => p.lastAt && now - Date.parse(p.lastAt) < ACTIVE_MS).length;
  return (
    <Card className="gap-2 py-4">
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <UsersIcon className="size-4" /> {t("Packing now")}
          </p>
          <span className="text-muted-foreground text-xs">{t("{n} active", { n: active })}</span>
        </div>
        <AnimatedList
          aria-label={t("Team")}
          items={team.map((p) => {
            const on = p.lastAt !== null && now - Date.parse(p.lastAt) < ACTIVE_MS;
            return {
              key: p.id,
              node: (
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className={cn("size-2 shrink-0 rounded-full", on ? "bg-success" : "bg-muted-foreground/30")}
                    aria-label={on ? t("Active") : t("Away")}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {p.name}
                    {p.id === meId && <span className="text-muted-foreground"> · {t("you")}</span>}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {t("{packed} packed · {verified} checked", { packed: p.packed, verified: p.verified })}
                  </span>
                </div>
              ),
            };
          })}
        />
      </CardContent>
    </Card>
  );
}

export type SessionStats = { packed: number; verified: number; problems: number; minutes: number };

/** "Finish for now": what this person did in this session, and a thank-you. */
export function SessionSummary({
  open,
  onOpenChange,
  firstName,
  stats,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firstName: string;
  stats: SessionStats;
}) {
  const t = useT();
  const items = [
    { label: t("Packed"), value: stats.packed },
    { label: t("Checked"), value: stats.verified },
    { label: t("Problems reported"), value: stats.problems },
    { label: t("Minutes"), value: stats.minutes },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center">
          <AnimateIcon animateOnView className="bg-success/15 text-success mb-1 flex size-14 items-center justify-center rounded-full">
            <PackageDelivered className="size-7" />
          </AnimateIcon>
          <DialogTitle className="text-xl">{t("Thank you, {name}!", { name: firstName })}</DialogTitle>
          <DialogDescription>
            {stats.packed + stats.verified > 0 ? t("Here is what you did this session.") : t("Nothing confirmed this session yet.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {items.map((i) => (
            <div key={i.label} className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="text-3xl font-semibold tabular-nums">
                <CountUp to={i.value} />
              </p>
              <p className="text-muted-foreground text-xs">{i.label}</p>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button className="w-full" onClick={() => onOpenChange(false)}>
            <HeartHandshakeIcon /> {t("Close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
