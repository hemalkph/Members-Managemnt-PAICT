// Is this a PDF? Readers accept the "%PDF-" marker anywhere in the first
// 1024 bytes, and some Citypak files start with a blank line before it.
const MARKER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function isPdf(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 1024) - MARKER.length;
  for (let i = 0; i <= end; i++) {
    if (MARKER.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}
