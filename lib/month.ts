// Month helpers. A "month key" is "YYYY-MM"; the database stores the first
// day of the month ("YYYY-MM-01") in submissions.work_month.
//
// Pay months run from the 11th to the 10th of the next month and are named
// after the month they start in: "October 2026" = 11 Oct – 10 Nov 2026.
// The database uses the same rule (public.pay_period_of).

/** The last day of a month's period: the 10th of the next month. */
export const PERIOD_END_DAY = 10;

export const APP_TIME_ZONE = "Asia/Colombo";

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Today's date in Sri Lanka as "YYYY-MM-DD". */
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** The pay month a day ("YYYY-MM-DD") belongs to. */
export function periodOfDay(day: string): string {
  const key = day.slice(0, 7);
  return Number(day.slice(8, 10)) <= PERIOD_END_DAY ? shiftMonth(key, -1) : key;
}

/** Today's pay month. */
export function currentMonthKey(): string {
  return periodOfDay(todayISO());
}

/** First and last day of a month's period as "YYYY-MM-DD". */
export function periodDays(key: string): { first: string; last: string } {
  const next = shiftMonth(key, 1);
  return { first: `${key}-${PERIOD_END_DAY + 1}`, last: `${next}-${String(PERIOD_END_DAY).padStart(2, "0")}` };
}

/** "11 Oct – 10 Nov 2026" */
export function periodRangeLabel(key: string): string {
  const { first, last } = periodDays(key);
  const fmt = (iso: string, withYear: boolean) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));
  return `${fmt(first, false)} – ${fmt(last, true)}`;
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY.test(value);
}

/** Read a ?month= search param, falling back to the current month. */
export function parseMonthParam(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return isMonthKey(v) ? v : currentMonthKey();
}

export function monthKeyToDate(key: string): string {
  return `${key}-01`;
}

export function dateToMonthKey(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string, style: "long" | "short" = "long"): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    month: style,
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** The latest `count` months, newest first (optionally starting from next month). */
export function recentMonths(count = 12, includeNext = false): string[] {
  const start = includeNext ? shiftMonth(currentMonthKey(), 1) : currentMonthKey();
  return Array.from({ length: count }, (_, i) => shiftMonth(start, -i));
}
