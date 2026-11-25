// Who's free: open work plus days off, as short labels for assign pickers,
// and the next working day when a deadline lands on someone's day off.
// Days off only warn; nothing here blocks saving.

export type DayOff = { id: string; userId: string; from: string; to: string; note: string };

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const dayNum = (day: string) => Number(day.slice(8, 10));
const mon = (day: string) => MONTH.format(new Date(`${day}T00:00:00Z`));

/** "26 Nov", "26–28 Nov" or "30 Nov – 2 Dec". */
export function shortRange(from: string, to: string): string {
  if (from === to) return `${dayNum(from)} ${mon(from)}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${dayNum(from)}–${dayNum(to)} ${mon(to)}`;
  return `${dayNum(from)} ${mon(from)} – ${dayNum(to)} ${mon(to)}`;
}

export function awayOn(daysOff: DayOff[], userId: string, day: string): DayOff | null {
  return daysOff.find((d) => d.userId === userId && d.from <= day && day <= d.to) ?? null;
}

/** The first day on or after `day` that isn't inside one of the person's days off. */
export function nextWorkingDay(daysOff: DayOff[], userId: string, day: string): string {
  let current = day;
  for (let guard = 0; guard < 400; guard++) {
    const hit = awayOn(daysOff, userId, current);
    if (!hit) return current;
    current = addDays(hit.to, 1);
  }
  return current;
}

/** The person's days off that overlap [from, to], earliest first. */
export const awayBetween = (daysOff: DayOff[], userId: string, from: string, to: string) =>
  daysOff
    .filter((d) => d.userId === userId && d.from <= to && d.to >= from)
    .sort((a, b) => a.from.localeCompare(b.from));

/** "3 open", or "3 open · away 26–28 Nov" when a day off overlaps [from, to]. */
export function availabilityLabel(open: number, daysOff: DayOff[], userId: string, from: string, to: string): string {
  const away = awayBetween(daysOff, userId, from, to);
  const base = `${open} open`;
  return away.length === 0 ? base : `${base} · away ${away.map((d) => shortRange(d.from, d.to)).join(", ")}`;
}

/** People with no day off in [from, to] first, then fewer open items; otherwise keeps the given order. */
export function freeFirst<T extends { id: string; open: number }>(
  members: T[],
  daysOff: DayOff[],
  from: string,
  to: string,
): T[] {
  return members
    .map((m, i) => ({ m, i, away: awayBetween(daysOff, m.id, from, to).length > 0 ? 1 : 0 }))
    .sort((a, b) => a.away - b.away || a.m.open - b.m.open || a.i - b.i)
    .map((x) => x.m);
}

export function mapDaysOff(
  rows: { id: string; user_id: string; day_from: string; day_to: string; note: string }[],
): DayOff[] {
  return rows.map((r) => ({ id: r.id, userId: r.user_id, from: r.day_from, to: r.day_to, note: r.note }));
}

export { addDays as addDaysISO };
