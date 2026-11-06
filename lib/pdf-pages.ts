/** True when a rate is paid per page ("page", "Pages"…), so PDF pages can fill the quantity. */
export function isPerPage(unit: string | undefined) {
  return /^pages?$/i.test(unit?.trim() ?? "");
}

/** Number of pages in a PDF file, or null when it is not a PDF or can't be read. */
export async function pdfPageCount(file: Blob & { name: string }): Promise<number | null> {
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return null;
  try {
    // Loaded only when a PDF is picked, so the form stays light.
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}
