// Month helpers. A "month key" is "YYYY-MM"; the database stores the first
// day of the month ("YYYY-MM-01") in submissions.work_month.

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

export function currentMonthKey(): string {
  return todayISO().slice(0, 7);
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
