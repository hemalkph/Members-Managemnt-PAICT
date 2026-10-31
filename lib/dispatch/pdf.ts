import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

/** Text of a PDF in reading order (for cross-checking Citypak labels only). */
export async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pages: totalPages, text: Array.isArray(text) ? text.join("\n") : text };
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}
