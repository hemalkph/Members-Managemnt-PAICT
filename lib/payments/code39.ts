// Code 39 barcodes for receipts (payslip numbers like "PS-2026-10-014").
// Each character is 9 elements (bar, space, bar, …), 1 = wide; exactly 3 are wide.
export const CODE39: Record<string, string> = {
  "0": "000110100", "1": "100100001", "2": "001100001", "3": "101100000", "4": "000110001",
  "5": "100110000", "6": "001110000", "7": "000100101", "8": "100100100", "9": "001100100",
  A: "100001001", B: "001001001", C: "101001000", D: "000011001", E: "100011000",
  F: "001011000", G: "000001101", H: "100001100", I: "001001100", J: "000011100",
  K: "100000011", L: "001000011", M: "101000010", N: "000010011", O: "100010010",
  P: "001010010", Q: "000000111", R: "100000110", S: "001000110", T: "000010110",
  U: "110000001", V: "011000001", W: "111000000", X: "010010001", Y: "110010000",
  Z: "011010000", "-": "010000101", ".": "110000100", " ": "011000100", "$": "010101000",
  "/": "010100010", "+": "010001010", "%": "000101010", "*": "010010100",
};

const NARROW = 1;
const WIDE = 3;

/** Bars (x and width in narrow units) for `*VALUE*`. Unsupported characters are dropped. */
export function code39Bars(value: string): { x: number; w: number }[] {
  const chars = ["*", ...value.toUpperCase().split("").filter((c) => c !== "*" && c in CODE39), "*"];
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  chars.forEach((c, i) => {
    if (i > 0) x += NARROW; // gap between characters
    CODE39[c].split("").forEach((bit, j) => {
      const w = bit === "1" ? WIDE : NARROW;
      if (j % 2 === 0) bars.push({ x, w });
      x += w;
    });
  });
  return bars;
}
