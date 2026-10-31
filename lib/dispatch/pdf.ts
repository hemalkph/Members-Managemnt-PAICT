import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

/** Text of a PDF in reading order (for cross-checking Citypak labels only). */
export async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  // pdf.js takes over (empties) the buffer it is given, so it gets a copy:
  // the caller still needs the bytes for the size and checksum.
  const pdf = await getDocumentProxy(bytes.slice());
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pages: totalPages, text: Array.isArray(text) ? text.join("\n") : text };
}

export { isPdf } from "./pdf-header";
