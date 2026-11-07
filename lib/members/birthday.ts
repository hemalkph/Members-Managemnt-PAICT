// Birthday helpers. Dates are "YYYY-MM-DD" strings; "today" is Sri Lanka time.

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function isLeapYear(y: number) {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

/** The birthday's month/day in a given year (29 Feb → 28 Feb in non-leap years). */
function birthdayIn(year: number, dob: string) {
  const { m, d } = parts(dob);
  const day = m === 2 && d === 29 && !isLeapYear(year) ? 28 : d;
  return Date.UTC(year, m - 1, day);
}

export function isBirthdayToday(dob: string | null | undefined, today: string): boolean {
  if (!dob) return false;
  const t = parts(today);
  return birthdayIn(t.y, dob) === Date.UTC(t.y, t.m - 1, t.d);
}

/** Days until the next birthday (0 = today). */
export function daysUntilBirthday(dob: string, today: string): number {
  const t = parts(today);
  const now = Date.UTC(t.y, t.m - 1, t.d);
  let next = birthdayIn(t.y, dob);
  if (next < now) next = birthdayIn(t.y + 1, dob);
  return Math.round((next - now) / 86_400_000);
}

/** Age in completed years on the given day. */
export function ageOn(dob: string, today: string): number {
  const b = parts(dob);
  const t = parts(today);
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age -= 1;
  return age;
}

export function formatBirthday(dob: string): string {
  const { m, d } = parts(dob);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, m - 1, d)),
  );
}

/** 1 → "1st", 22 → "22nd", 13 → "13th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}
