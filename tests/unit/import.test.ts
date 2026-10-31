import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import {
  buildCandidates,
  classify,
  countByStatus,
  detectMapping,
  issuesCsv,
  parseCsv,
  sheetFromMatrix,
  studentNoFromReference,
  type ExistingStudent,
} from "@/lib/dispatch/import";
import { detectKind, ImportFileError, readSheet } from "@/lib/dispatch/xlsx";
import { CITYPAK_COLUMNS, syntheticCitypakRows } from "../fixtures/citypak";

const toCsv = (rows: string[][]) =>
  rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");

async function toXlsx(rows: (string | number)[][], format?: (ws: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((r) => ws.addRow(r));
  format?.(ws);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function saved(over: Partial<ExistingStudent> & { student_no: string; full_name: string }): ExistingStudent {
  return {
    id: crypto.randomUUID(),
    address_line1: "",
    address_line2: "",
    address_line3: "",
    city: "",
    region: "",
    phone1: null,
    phone2: null,
    delivery_note: "",
    updated_at: "2026-10-31 10:00:00.123456+00",
    anonymised_at: null,
    ...over,
  };
}

describe("column detection", () => {
  test("recognises all Citypak receiver columns and takes the student number from Your Reference", () => {
    const m = detectMapping([...CITYPAK_COLUMNS]);
    const col = (name: string) => CITYPAK_COLUMNS.indexOf(name as (typeof CITYPAK_COLUMNS)[number]);
    expect(m.student_no).toEqual({ column: col("Your Reference"), fromReference: true });
    expect(m.full_name?.column).toBe(col("Receiver's Address Name"));
    expect(m.address_line1?.column).toBe(col("Receiver's Address Line 1"));
    expect(m.city?.column).toBe(col("Receiver's Address Line 4 - City"));
    expect(m.phone1?.column).toBe(col("Receiver's Contact Number 1"));
    expect(m.phone2?.column).toBe(col("Receiver's Contact Number 2"));
    // Sender columns must never be mistaken for the student.
    expect(Object.values(m).every((s) => !CITYPAK_COLUMNS[s!.column].startsWith("Sender"))).toBe(true);
  });

  test("student number from a reference keeps leading zeros", () => {
    expect(studentNoFromReference("27TGROCTICT088")).toBe("088");
    expect(studentNoFromReference("NO-DIGITS")).toBeNull();
  });
});

describe("synthetic 59-row Citypak file", () => {
  const rows = syntheticCitypakRows();

  test("CSV: 59 rows, leading zeros kept, 093 absent, quirks handled", async () => {
    const { kind, sheet } = await readSheet(new TextEncoder().encode(toCsv([[...CITYPAK_COLUMNS], ...rows])));
    expect(kind).toBe("csv");
    const cands = buildCandidates(sheet, detectMapping(sheet.header));
    expect(cands).toHaveLength(59);
    const nos = cands.map((c) => c.values.student_no);
    expect(nos[0]).toBe("088");
    expect(nos).not.toContain("093");
    const c92 = cands.find((c) => c.values.student_no === "092")!;
    expect(c92.values.phone1).toBe("0771163730");
    expect(c92.phoneStatus.phone1).toBe("fixed");
    const c126 = cands.find((c) => c.values.student_no === "126")!;
    expect(c126.values.phone1).toBe("0741043970");
    expect(c126.phone1Raw).toBe("=+94741043970");
    expect(c126.warnings.join(" ")).toMatch(/formula/);
  });

  test("XLSX: same result as CSV", async () => {
    const { kind, sheet } = await readSheet(await toXlsx([[...CITYPAK_COLUMNS], ...rows]));
    expect(kind).toBe("xlsx");
    const cands = buildCandidates(sheet, detectMapping(sheet.header));
    expect(cands).toHaveLength(59);
    expect(cands.find((c) => c.values.student_no === "126")?.phone1Raw).toBe("=+94741043970");
  });

  test("first import: 58 new, 1 needs review; second import: all 59 unchanged", async () => {
    const { sheet } = await readSheet(new TextEncoder().encode(toCsv([[...CITYPAK_COLUMNS], ...rows])));
    const mapping = detectMapping(sheet.header);
    const cands = buildCandidates(sheet, mapping);

    const first = classify(cands, [], mapping);
    expect(countByStatus(first)).toEqual({ new: 58, updated: 0, unchanged: 0, review: 1, invalid: 0 });
    expect(first.find((r) => r.studentNo === "126")).toMatchObject({ status: "review", defaultSelected: false });

    const existing = first.map((r) =>
      saved({
        student_no: r.studentNo,
        full_name: r.apply!.full_name,
        address_line1: r.apply!.address_line1,
        city: r.apply!.city,
        phone1: r.apply!.phone1 || null,
      }),
    );
    const second = classify(cands, existing, mapping);
    // Nothing to save, so even 126 (with its formula warning) is simply unchanged.
    expect(countByStatus(second)).toEqual({ new: 0, updated: 0, unchanged: 59, review: 0, invalid: 0 });
    expect(second.every((r) => r.apply === null && !r.defaultSelected)).toBe(true);
  });
});

describe("classification", () => {
  const header = ["Student No", "Name", "Address", "City", "Phone"];
  const build = (rows: string[][]) => {
    const sheet = sheetFromMatrix([header, ...rows]);
    const mapping = detectMapping(sheet.header);
    return { mapping, cands: buildCandidates(sheet, mapping) };
  };

  test("an address change is an update shown old → new and is never pre-ticked", () => {
    const { mapping, cands } = build([["088", "Amaya Perera", "2 New Road", "Kandy", "0771234567"]]);
    const [row] = classify(cands, [saved({ student_no: "088", full_name: "Amaya Perera", address_line1: "1 Old Road", city: "Kandy", phone1: "0771234567" })], mapping);
    expect(row.status).toBe("updated");
    expect(row.changes).toEqual([{ field: "address_line1", label: "Address line 1", from: "1 Old Road", to: "2 New Road" }]);
    expect(row.defaultSelected).toBe(false);
    expect(row.apply).toMatchObject({ action: "update", address_line1: "2 New Road", expected_updated_at: "2026-10-31 10:00:00.123456+00" });
  });

  test("an empty cell never blanks out saved details", () => {
    const { mapping, cands } = build([["088", "Amaya Perera", "", "", ""]]);
    const [row] = classify(cands, [saved({ student_no: "088", full_name: "Amaya Perera", address_line1: "1 Old Road", phone1: "0771234567" })], mapping);
    expect(row.status).toBe("unchanged");
  });

  test("the same student number twice in a file makes both rows invalid", () => {
    const { mapping, cands } = build([
      ["088", "A One", "x", "Kandy", "0771111111"],
      ["088", "A Two", "y", "Galle", "0772222222"],
    ]);
    expect(classify(cands, [], mapping).map((r) => r.status)).toEqual(["invalid", "invalid"]);
  });

  test("missing name or number is invalid; missing address needs review", () => {
    const { mapping, cands } = build([
      ["", "No Number", "x", "Kandy", ""],
      ["090", "", "x", "Kandy", ""],
      ["091", "No Address", "", "Kandy", ""],
    ]);
    expect(classify(cands, [], mapping).map((r) => r.status)).toEqual(["invalid", "invalid", "review"]);
  });

  test("formula-like text is stripped and flagged", () => {
    const { mapping, cands } = build([["095", '=HYPERLINK("http://x","Click")', "x", "Kandy", ""]]);
    const [row] = classify(cands, [], mapping);
    expect(row.status).toBe("review");
    expect(row.apply?.full_name.startsWith("=")).toBe(false);
  });

  test("an anonymised student can't be updated by import", () => {
    const { mapping, cands } = build([["088", "Real Name", "x", "Kandy", ""]]);
    const [row] = classify(cands, [saved({ student_no: "088", full_name: "Student 088", anonymised_at: "2026-01-01" })], mapping);
    expect(row.status).toBe("invalid");
  });

  test("the same name and phone under another number is flagged", () => {
    const { mapping, cands } = build([["099", "Amaya Perera", "x", "Kandy", "0771234567"]]);
    const [row] = classify(cands, [saved({ student_no: "088", full_name: "Amaya Perera", phone1: "0771234567" })], mapping);
    expect(row.status).toBe("review");
    expect(row.warnings.join(" ")).toMatch(/088/);
  });
});

describe("file safety", () => {
  test("leading zeros survive in xlsx when the column is formatted as text or 000", async () => {
    const bytes = await toXlsx([["Student No", "Name"], [88, "Zero Lead"], ["007", "Text Cell"]], (ws) => {
      ws.getCell("A2").numFmt = "000";
    });
    const { sheet } = await readSheet(bytes);
    const cands = buildCandidates(sheet, detectMapping(sheet.header));
    expect(cands.map((c) => c.values.student_no)).toEqual(["088", "007"]);
  });

  test("a formula cell is read as its value and flagged", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.addRow(["Student No", "Name"]);
    ws.addRow(["101", { formula: 'CONCAT("A","B")', result: "AB" }]);
    const { sheet } = await readSheet(new Uint8Array(await wb.xlsx.writeBuffer()));
    const [c] = buildCandidates(sheet, detectMapping(sheet.header));
    expect(c.values.full_name).toBe("AB");
    expect(c.warnings.join(" ")).toMatch(/formula/);
  });

  test("binary files that are not xlsx are refused", () => {
    expect(detectKind(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBeNull();
    expect(detectKind(new TextEncoder().encode("a,b\n1,2"))).toBe("csv");
  });

  test("more than 2,000 rows are refused", async () => {
    const big = [["Student No", "Name"], ...Array.from({ length: 2002 }, (_, i) => [String(i), "N"])];
    await expect(readSheet(new TextEncoder().encode(toCsv(big)))).rejects.toBeInstanceOf(ImportFileError);
  });

  test("the issues report cannot inject formulas", () => {
    const { mapping, cands } = (() => {
      const sheet = sheetFromMatrix([["Student No", "Name"], ["", "=cmd|' /C calc'!A0"]]);
      const m = detectMapping(sheet.header);
      return { mapping: m, cands: buildCandidates(sheet, m) };
    })();
    const csv = issuesCsv(classify(cands, [], mapping));
    const cells = parseCsv(csv)[1];
    expect(cells.every((c) => !/^[=+\-@]/.test(c))).toBe(true);
  });

  test("CSV parser handles quotes, commas and line breaks", () => {
    expect(parseCsv('a,"b,c","d ""q"""\r\n"x\ny",z')).toEqual([
      ["a", "b,c", 'd "q"'],
      ["x\ny", "z"],
    ]);
  });
});
