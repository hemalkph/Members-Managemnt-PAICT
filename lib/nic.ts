// Sri Lankan NIC helpers. Mirrors public.nic_birth_date() in the database
// (the database is the source of truth; this is for live previews in forms).
//   Old NIC: YYDDDnnnnV/X (year 19YY)   New NIC: YYYYDDDnnnnn
//   DDD = day of the year (+500 for women), always counting February as 29 days.

const LEAP_MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(y: number) {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

export type NicInfo = { dateOfBirth: string; gender: "male" | "female" };

/** Date of birth ("YYYY-MM-DD") and gender from a NIC, or null if it is not valid. */
export function parseNic(nic: string | null | undefined): NicInfo | null {
  const v = (nic ?? "").trim().toUpperCase();
  let year: number;
  let day: number;
  if (/^[0-9]{9}[VX]$/.test(v)) {
    year = 1900 + Number(v.slice(0, 2));
    day = Number(v.slice(2, 5));
  } else if (/^[0-9]{12}$/.test(v)) {
    year = Number(v.slice(0, 4));
    day = Number(v.slice(4, 7));
  } else {
    return null;
  }

  const gender = day > 500 ? "female" : "male";
  if (day > 500) day -= 500;
  if (day < 1 || day > 366) return null;

  let month = 0;
  while (day > LEAP_MONTH_DAYS[month]) {
    day -= LEAP_MONTH_DAYS[month];
    month += 1;
  }
  if (month === 1 && day === 29 && !isLeapYear(year)) return null;

  const dateOfBirth = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { dateOfBirth, gender };
}
