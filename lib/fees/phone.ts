// Phone normalization for Sri Lankan + international WhatsApp numbers.
// Handles:
//   "0782480847"    -> "94782480847"
//   "94782480847"   -> "94782480847"
//   "+94 778184045" -> "94778184045"
//   "774309816"     -> "94774309816" (Excel-stripped leading 0)
//   "077 1163730"   -> "94771163730"
//   "393246630328"  -> "393246630328" (international, e.g. Italy +39)

/** Expand scientific notation (e.g. "9.4782480847E10" or "3.93246630328E+11") to an integer digit string. */
export function expandExcelNumericString(raw: string): string {
  const trimmed = raw.trim();
  const sci = trimmed.match(/^[+-]?(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (sci) {
    const intPart = sci[1];
    const fracPart = sci[2] ?? "";
    const exp = parseInt(sci[3], 10);
    if (exp >= 0 && exp <= 20) {
      const digits = intPart + fracPart;
      const shift = exp - fracPart.length;
      if (shift >= 0) return digits + "0".repeat(shift);
      // Fractional decimal left over: take integer part if trailing digits are zeros.
      const intLen = digits.length + shift;
      if (intLen > 0) return digits.slice(0, intLen);
    }
  }
  // Strip trailing ".0" / ".00" added when numeric phone cells are formatted as floats.
  if (/^\d+\.0+$/.test(trimmed)) {
    return trimmed.slice(0, trimmed.indexOf("."));
  }
  return trimmed;
}

/**
 * Normalize a raw phone / WhatsApp string into digits-only E.164 (without "+")
 * suitable for api.whatsapp.com/send/?phone=... and cross-month identity matching.
 */
export function normalizeWaPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = expandExcelNumericString(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Sri Lankan local 10-digit number starting with 0 (e.g. 0771234567, 0112345678).
  if (digits.length === 10 && digits.startsWith("0")) {
    digits = `94${digits.slice(1)}`;
  }
  // Sri Lankan 9-digit mobile with leading 0 stripped by Excel (e.g. 774309816).
  else if (digits.length === 9 && digits.startsWith("7")) {
    digits = `94${digits}`;
  }
  // Accidental 0947xxxxxxxx (12 digits starting with 094).
  else if (digits.length === 12 && digits.startsWith("094")) {
    digits = digits.slice(1);
  }
  // Accidental 9407xxxxxxxx (12 digits with an extra 0 after 94).
  else if (digits.length === 12 && digits.startsWith("940")) {
    digits = `94${digits.slice(3)}`;
  }

  // Valid international E.164 lengths (excluding '+') are 10..15 digits (some SL/short ints 9..15).
  if (digits.length < 10 || digits.length > 15) return null;
  // Reject all-zero or obviously fake repeated single digit numbers.
  if (/^(\d)\1+$/.test(digits)) return null;
  return digits;
}

/** Human-friendly display format, e.g. "+94 78 248 0847" or "+39 3246630328". */
export function formatPhoneDisplay(norm: string | null | undefined): string {
  if (!norm) return "—";
  if (norm.startsWith("94") && norm.length === 11) {
    return `+94 ${norm.slice(2, 4)} ${norm.slice(4, 7)} ${norm.slice(7)}`;
  }
  return `+${norm}`;
}

export type ResolvedPhone =
  | { number: string; source: "whatsapp" | "mobile" }
  | { number: null; source: "none" };

/** Prefer normalized WhatsApp number; fall back to normalized Mobile when WhatsApp is missing/invalid. */
export function pickContactPhone(whatsappNorm: string | null, mobileNorm: string | null): ResolvedPhone {
  if (whatsappNorm) return { number: whatsappNorm, source: "whatsapp" };
  if (mobileNorm) return { number: mobileNorm, source: "mobile" };
  return { number: null, source: "none" };
}
