import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { isPerPage, pdfPageCount } from "@/lib/pdf-pages";

async function pdfFile(pages: number, name = "paper.pdf", type = "application/pdf") {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return new File([new Uint8Array(await doc.save())], name, { type });
}

describe("pdfPageCount", () => {
  it("counts the pages of a PDF", async () => {
    expect(await pdfPageCount(await pdfFile(7))).toBe(7);
  });

  it("reads a PDF by its name when the browser gives no type", async () => {
    expect(await pdfPageCount(await pdfFile(3, "Paper.PDF", ""))).toBe(3);
  });

  it("skips files that are not PDFs", async () => {
    expect(await pdfPageCount(new File(["hi"], "notes.docx"))).toBeNull();
  });

  it("returns null for a broken PDF", async () => {
    expect(await pdfPageCount(new File(["not a pdf"], "bad.pdf", { type: "application/pdf" }))).toBeNull();
  });
});

describe("isPerPage", () => {
  it("matches page units only", () => {
    expect(isPerPage("page")).toBe(true);
    expect(isPerPage(" Pages ")).toBe(true);
    expect(isPerPage("paper")).toBe(false);
    expect(isPerPage(undefined)).toBe(false);
  });
});
