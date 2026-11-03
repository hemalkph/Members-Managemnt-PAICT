// Fixture (demo) data for the Citypak screens. Synthetic only: no real batch,
// person, address or phone. Responses use Citypak's observed JSON shape so the
// same parser runs in fixture and live mode. Documents are generated here and
// say "FIXTURE – not a Citypak document" on every sheet and page.
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";

export const FIXTURE_TOTAL = 37;
export const FIXTURE_PER_PAGE = 25;
const FIRST_ID = 900001;

function fixtureRecord(i: number) {
  const id = FIRST_ID + i;
  const failed = i % 7 === 3;
  const day = new Date(Date.UTC(2026, 9, 31) - i * 86_400_000 * 1.5);
  const at = (minutes: number) => {
    const d = new Date(day.getTime() + minutes * 60_000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  };
  return {
    id,
    tracking_number: `FX-BATCH-${String(FIXTURE_TOTAL - i).padStart(4, "0")}`,
    excel_file_url: `fixtures/bulk-uploads/${id}.xlsx`,
    status: failed ? "FAILED" : "SUCCESS",
    started_datetime: at(0),
    ended_datetime: at(failed ? 1 : 3),
    created_at: at(0),
    waybills: failed ? 0 : 8 + ((i * 13) % 90),
    fileName: `fixture-batch-${String(FIXTURE_TOTAL - i).padStart(4, "0")}.xlsx`,
  };
}

/** One page of the bulk-upload list, in Citypak's envelope (newest first). */
export function fixtureBulkUploadsJson(page: number) {
  const lastPage = Math.max(1, Math.ceil(FIXTURE_TOTAL / FIXTURE_PER_PAGE));
  const start = (page - 1) * FIXTURE_PER_PAGE;
  const data = Array.from({ length: FIXTURE_TOTAL }, (_, i) => fixtureRecord(i)).slice(start, start + FIXTURE_PER_PAGE);
  return {
    status: true,
    data: {
      current_page: page,
      data,
      last_page: lastPage,
      per_page: FIXTURE_PER_PAGE,
      total: FIXTURE_TOTAL,
      next_page_url: page < lastPage ? `fixture://bulk-uploads?page=${page + 1}` : null,
    },
  };
}

export function fixtureHas(externalId: number): boolean {
  return Number.isInteger(externalId) && externalId >= FIRST_ID && externalId < FIRST_ID + FIXTURE_TOTAL;
}

/** Waybills in a fixture batch (0 for failed ones). */
export function fixtureWaybillCount(externalId: number): number {
  return fixtureHas(externalId) ? fixtureRecord(externalId - FIRST_ID).waybills : 0;
}

const BANNER = "FIXTURE – not a Citypak document";

/** A small workbook shaped like a filled bulk-upload sheet, with synthetic rows only. */
export async function fixtureExcel(externalId: number, waybills: number): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Waybills");
  ws.addRow([BANNER]);
  ws.addRow([`Bulk upload ${externalId}`]);
  ws.addRow(["Your Reference", "Citypak Tracking", "COD (Rs.)"]);
  for (let i = 1; i <= Math.min(waybills, 200); i++) {
    ws.addRow([`FXREF${String(i).padStart(3, "0")}`, `D9${String(externalId).slice(-4)}${String(i).padStart(3, "0")}`, 0]);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** 4×6 inch label pages (one per waybill, at most 20), each marked as a fixture. */
export async function fixtureWaybills(externalId: number, waybills: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${BANNER} – bulk upload ${externalId}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= Math.max(1, Math.min(waybills, 20)); i++) {
    const page = pdf.addPage([288, 432]); // 4 × 6 inches
    // pdf-lib's standard fonts are WinAnsi only, so use a plain hyphen.
    page.drawText("FIXTURE - not a Citypak document", { x: 18, y: 400, size: 12, font: bold });
    page.drawText(`Bulk upload ${externalId}`, { x: 18, y: 376, size: 10, font });
    page.drawText(`Waybill ${i} of ${waybills}`, { x: 18, y: 360, size: 10, font });
    page.drawText(`D9${String(externalId).slice(-4)}${String(i).padStart(3, "0")}`, { x: 18, y: 320, size: 22, font: bold });
    page.drawText(`Reference FXREF${String(i).padStart(3, "0")}`, { x: 18, y: 296, size: 10, font });
  }
  return pdf.save();
}

// ---------------------------------------------------------------- orders ("orders/created")
export const FIXTURE_ORDER_TOTAL = 42;
const FIRST_ORDER_ID = 7_100_001;

/**
 * A synthetic Citypak order with only the fields seen in Citypak's responses.
 * References start with FXO, so they never equal a real parcel reference.
 * Every 9th order has no reference; orders 20 and 21 share a tracking number,
 * so the demo also shows how a conflict looks.
 */
function fixtureOrder(i: number) {
  const n = FIXTURE_ORDER_TOTAL - i;
  const created = new Date(Date.UTC(2026, 9, 31, 6) - i * 5 * 3_600_000);
  return {
    id: FIRST_ORDER_ID + i,
    tracking_number: `D9${String(i === 21 ? 20 : i).padStart(7, "0")}`,
    reference: i % 9 === 4 ? null : `FXO${String(n).padStart(5, "0")}`,
    created_at: created.toISOString().slice(0, 19).replace("T", " "),
  };
}

/** One page of the orders list, in Citypak's envelope (newest first). */
export function fixtureOrdersJson(page: number) {
  const lastPage = Math.max(1, Math.ceil(FIXTURE_ORDER_TOTAL / FIXTURE_PER_PAGE));
  const start = (page - 1) * FIXTURE_PER_PAGE;
  const data = Array.from({ length: FIXTURE_ORDER_TOTAL }, (_, i) => fixtureOrder(i)).slice(start, start + FIXTURE_PER_PAGE);
  return {
    status: true,
    data: {
      current_page: page,
      data,
      last_page: lastPage,
      per_page: FIXTURE_PER_PAGE,
      total: FIXTURE_ORDER_TOTAL,
      next_page_url: page < lastPage ? `fixture://orders/created?page=${page + 1}` : null,
    },
  };
}
