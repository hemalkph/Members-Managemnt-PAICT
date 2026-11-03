// Small helpers for the packing station (no React, easy to test).

import type { Lang } from "@/lib/dispatch/i18n";
import type { LookupResult } from "@/lib/dispatch/packing";

/** One colour per tute, in the round's tute order, so a stack on the table can carry the same colour. */
export const TUTE_COLORS = [
  { tile: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-50", dot: "bg-sky-500" },
  { tile: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-50", dot: "bg-amber-500" },
  { tile: "border-violet-300 bg-violet-50 text-violet-950 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-50", dot: "bg-violet-500" },
  { tile: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-50", dot: "bg-emerald-500" },
  { tile: "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-50", dot: "bg-rose-500" },
  { tile: "border-teal-300 bg-teal-50 text-teal-950 dark:border-teal-700 dark:bg-teal-950/50 dark:text-teal-50", dot: "bg-teal-500" },
  { tile: "border-orange-300 bg-orange-50 text-orange-950 dark:border-orange-700 dark:bg-orange-950/50 dark:text-orange-50", dot: "bg-orange-500" },
  { tile: "border-indigo-300 bg-indigo-50 text-indigo-950 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-50", dot: "bg-indigo-500" },
] as const;

export function tuteColor(code: string, codes: string[]) {
  const i = codes.indexOf(code);
  return TUTE_COLORS[(i < 0 ? [...code].reduce((s, c) => s + c.charCodeAt(0), 0) : i) % TUTE_COLORS.length];
}

/** "Good morning" / "Good afternoon" / "Good evening" by the hour (0–23). */
export function greeting(hour: number): string {
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

const PAUSE_MS = 5 * 60_000;

/**
 * Minutes to finish `remaining` parcels at this person's pace, from the times
 * of their confirms (ms). Gaps over 5 minutes are breaks and don't count.
 * Null until there are 3 confirms to go on.
 */
export function paceMinutes(times: number[], remaining: number): number | null {
  if (times.length < 3 || remaining <= 0) return null;
  const gaps = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((g) => g > 0 && g < PAUSE_MS);
  if (gaps.length < 2) return null;
  const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  return Math.max(1, Math.round((avg * remaining) / 60_000));
}

/** When the current stretch of work began: the first confirm after the last gap of 10+ minutes. */
export function workStart(times: number[]): number | null {
  if (times.length === 0) return null;
  let start = times[0];
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] >= 10 * 60_000) start = times[i];
  return start;
}

/** Celebrate every 25 parcels by this person in this session. */
export const MILESTONE = 25;
export const isMilestone = (count: number) => count > 0 && count % MILESTONE === 0;

/** What the station reads out: each tute and its copies. */
export function speechText(items: { code: string; qty: number }[], lang: Lang): string {
  return items
    .map((i) => (lang === "si" ? `${i.code}, පිටපත් ${i.qty}` : `${i.code}, ${i.qty} ${i.qty === 1 ? "copy" : "copies"}`))
    .join(". ");
}

/** Plain words for a scan that can't go ahead, and what to do with the parcel. */
export const LOOKUP_ADVICE: Record<Exclude<LookupResult["result"], "ready">, { title: string; hint: string }> = {
  duplicate: { title: "Already done", hint: "Put it with the finished parcels." },
  not_ready: { title: "Not ready yet", hint: "Put it aside and tell a planner." },
  not_assigned: { title: "This parcel is for someone else", hint: "Pass it to the person it is assigned to." },
  blocked: { title: "This parcel can't be changed", hint: "Put it aside and tell a planner." },
  wrong_round: { title: "This label is from another round", hint: "Put it aside – it doesn't belong here." },
  unknown: { title: "We can't find this code", hint: "Check the label and scan again, or type the reference." },
};
