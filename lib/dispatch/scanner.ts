// Rules of the packing station that must never drift: what a key press may
// do, and when "Confirm" is allowed. Pure, so they are unit tested.

export type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean };

/**
 * Only Ctrl+Enter, ⌘+Enter or F9 confirm. A barcode scanner types the code and
 * a plain Enter, so plain Enter (and Space) must never confirm a parcel.
 */
export function isConfirmShortcut(e: KeyLike): boolean {
  if (e.key === "F9") return !e.ctrlKey && !e.metaKey && !e.altKey;
  return e.key === "Enter" && Boolean(e.ctrlKey || e.metaKey) && !e.altKey;
}

/** A scanned or typed code, cleaned: no spaces or control characters, upper case, at most 64 characters. */
export function cleanScan(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f\s]/g, "")
    .toUpperCase()
    .slice(0, 64);
}

/** Citypak tracking numbers look like D + 8 digits. */
export function looksLikeTracking(code: string): boolean {
  return /^D\d{8}$/.test(code);
}

/** Confirm stays off for a moment after a card opens, so a double tap or a scanner's Enter can't land on it. */
export const CONFIRM_DELAY_MS = 600;

export function canConfirm(opts: {
  itemIds: string[];
  ticked: ReadonlySet<string>;
  openedAt: number;
  now: number;
  pending: boolean;
}): boolean {
  if (opts.pending || opts.itemIds.length === 0) return false;
  if (opts.now - opts.openedAt < CONFIRM_DELAY_MS) return false;
  return opts.itemIds.every((id) => opts.ticked.has(id));
}
