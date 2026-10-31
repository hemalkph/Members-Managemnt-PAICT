// Sri Lankan phone numbers, cleaned conservatively. The original text is
// always kept so a person can check anything that was changed or guessed.

export type PhoneStatus = "empty" | "ok" | "fixed" | "review" | "invalid";

export type PhoneResult = {
  /** 0XXXXXXXXX, or null when it can't be trusted. */
  value: string | null;
  raw: string;
  status: PhoneStatus;
  /** Why it needs a look (shown in the import preview). */
  note?: string;
};

/** Starts like a spreadsheet formula (=, @, tab, carriage return). */
export function looksLikeFormula(text: string): boolean {
  return /^[=@\t\r]/.test(text);
}

export function normalisePhone(input: string | null | undefined): PhoneResult {
  const raw = (input ?? "").trim();
  if (raw === "") return { value: null, raw, status: "empty" };

  const formula = looksLikeFormula(raw);
  const digits = raw.replace(/^[='"]+/, "").replace(/[\s\-().]/g, "");

  let value: string | null = null;
  let guessed = false;
  if (/^\+94\d{9}$/.test(digits)) value = `0${digits.slice(3)}`;
  else if (/^94\d{9}$/.test(digits)) value = `0${digits.slice(2)}`;
  else if (/^0\d{9}$/.test(digits)) value = digits;
  else if (/^7\d{8}$/.test(digits)) value = `0${digits}`; // mobile without the leading 0
  else if (/^[1-9]\d{8}$/.test(digits)) {
    value = `0${digits}`; // probably a landline without the 0 – needs a look
    guessed = true;
  }

  if (value === null) return { value: null, raw, status: "invalid", note: "Not a Sri Lankan phone number" };
  if (formula) return { value, raw, status: "review", note: "Was stored like a spreadsheet formula" };
  if (guessed) return { value, raw, status: "review", note: "Added a leading 0 – check the number" };
  return { value, raw, status: value === raw ? "ok" : "fixed" };
}
