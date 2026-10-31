// Reads an uploaded .xlsx or .csv into a Sheet. Server only (uses exceljs).
// Values are read as text; formulas are never evaluated, only flagged.

import ExcelJS from "exceljs";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsv, sheetFromMatrix, type Sheet } from "./import";

const MAX_COLUMNS = 60;

export type FileKind = "xlsx" | "csv";

/** Decide the type from the file's first bytes, not its name. */
export function detectKind(bytes: Uint8Array): FileKind | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "xlsx";
  // CSV: valid UTF-8 text with no NUL bytes.
  if (bytes.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
    return "csv";
  } catch {
    return null;
  }
}

export class ImportFileError extends Error {}

/**
 * A cell as the person sees it. exceljs does not apply number formats, so a
 * number shown with leading zeros ("000" → 088) is padded here.
 */
function cellText(cell: ExcelJS.Cell): string {
  if (cell.type === ExcelJS.ValueType.Number && typeof cell.value === "number") {
    const fmt = cell.numFmt ?? "";
    if (/^0+$/.test(fmt) && Number.isInteger(cell.value) && cell.value >= 0) {
      return String(cell.value).padStart(fmt.length, "0");
    }
  }
  return cell.text ?? "";
}

export async function readSheet(bytes: Uint8Array): Promise<{ kind: FileKind; sheet: Sheet }> {
  if (bytes.length === 0) throw new ImportFileError("The file is empty.");
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportFileError("The file is larger than 15 MB.");
  const kind = detectKind(bytes);
  if (!kind) throw new ImportFileError("Upload an Excel (.xlsx) or CSV file.");

  if (kind === "csv") {
    const matrix = parseCsv(new TextDecoder("utf-8").decode(bytes));
    if (matrix.length > MAX_IMPORT_ROWS + 1) throw new ImportFileError(`Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
    return { kind, sheet: sheetFromMatrix(matrix.map((r) => r.slice(0, MAX_COLUMNS))) };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError("This Excel file could not be read. Save it again as .xlsx and retry.");
  }
  const ws = workbook.worksheets[0];
  if (!ws) throw new ImportFileError("The workbook has no sheets.");
  if (ws.actualRowCount > MAX_IMPORT_ROWS + 1) throw new ImportFileError(`Import at most ${MAX_IMPORT_ROWS} rows at a time.`);

  const columns = Math.min(ws.actualColumnCount || ws.columnCount, MAX_COLUMNS);
  const matrix: string[][] = [];
  const formula: boolean[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values: string[] = [];
    const flags: boolean[] = [];
    for (let c = 1; c <= columns; c++) {
      const cell = row.getCell(c);
      values.push(cellText(cell));
      flags.push(cell.type === ExcelJS.ValueType.Formula);
    }
    matrix[rowNumber - 1] = values;
    formula[rowNumber - 1] = flags;
  });
  for (let i = 0; i < matrix.length; i++) {
    matrix[i] ??= [];
    formula[i] ??= [];
  }
  return { kind, sheet: sheetFromMatrix(matrix, formula) };
}
