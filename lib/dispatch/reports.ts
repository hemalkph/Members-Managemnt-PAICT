import "server-only";

import ExcelJS from "exceljs";
import type { Database } from "@/lib/database.types";
import { safeCell } from "./money";

export { reportRange } from "./money";

export type ReportRound = Database["public"]["Functions"]["dispatch_report_rounds"]["Returns"][number];
export type ReportPerson = Database["public"]["Functions"]["dispatch_report_people"]["Returns"][number];

/** An Excel workbook of the report. Text cells can't start a formula. */
export async function reportWorkbook(range: { from: string; to: string }, rounds: ReportRound[], people: ReportPerson[], money: boolean) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Tute dispatch";
  const ws = wb.addWorksheet("Rounds");
  const cols: { header: string; key: keyof ReportRound; width: number; money?: boolean }[] = [
    { header: "Round", key: "name", width: 32 },
    { header: "Month", key: "sending_month", width: 12 },
    { header: "State", key: "state", width: 11 },
    { header: "Parcels", key: "live", width: 9 },
    { header: "Resent", key: "replacements", width: 9 },
    { header: "Voided", key: "voided", width: 9 },
    { header: "Handed over", key: "handed_over", width: 12 },
    { header: "Delivered", key: "delivered", width: 10 },
    { header: "Returned", key: "returned", width: 10 },
    { header: "Not finished", key: "unresolved", width: 12 },
    { header: "Open problems", key: "open_exceptions", width: 13 },
    { header: "COD expected", key: "cod_expected", width: 14, money: true },
    ...(money
      ? ([
          { header: "COD received", key: "cod_paid", width: 14, money: true },
          { header: "Courier fees", key: "cod_fees", width: 13, money: true },
          { header: "Written off", key: "cod_written_off", width: 12, money: true },
          { header: "Still owed", key: "cod_outstanding", width: 12, money: true },
        ] as const)
      : []),
  ];
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: "#,##0.00" } : {} }));
  for (const r of rounds) {
    ws.addRow(Object.fromEntries(cols.map((c) => [c.key, c.money ? Number(r[c.key] ?? 0) : safeCell(r[c.key] as string | number | null)])));
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const ps = wb.addWorksheet("People");
  ps.columns = [
    { header: "Name", key: "name", width: 28 },
    { header: "Packed", key: "packed", width: 10 },
    { header: "Verified", key: "verified", width: 10 },
    { header: "Handed over", key: "handed_over", width: 12 },
  ];
  for (const p of people) ps.addRow({ name: safeCell(p.name ?? "Former member"), packed: p.packed, verified: p.verified, handed_over: p.handed_over });
  ps.getRow(1).font = { bold: true };

  const info = wb.addWorksheet("About");
  info.addRow([`Tute dispatch report, ${range.from} to ${range.to}`]);
  info.addRow(["Parcels counts exclude voided parcels. COD received counts confirmed settlements only."]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
