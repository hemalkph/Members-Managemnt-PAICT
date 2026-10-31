import { describe, expect, test } from "vitest";
import { sheetFromMatrix } from "@/lib/dispatch/import";
import { reviewRound, type ReviewStudent } from "@/lib/dispatch/review";
import {
  blockingTracking,
  checkWaybills,
  detectTrackingColumns,
  pairsFromText,
  reconcileTracking,
  type ManifestParcel,
} from "@/lib/dispatch/tracking";
import { CITYPAK_COLUMNS, syntheticCitypakRows } from "../fixtures/citypak";

const PREFIX = "27TGROCTICT";

/** Our manifest for the synthetic sample: the same people, no tracking numbers yet. */
function manifestFor(rows: string[][]): ManifestParcel[] {
  return rows.map((r) => ({
    id: crypto.randomUUID(),
    reference: r[1],
    trackingNo: null,
    voided: false,
    name: r[10],
    phone1: null,
    city: r[14],
    cod: 500,
  }));
}

describe("tracking sheet", () => {
  const rows = syntheticCitypakRows();
  const sheet = sheetFromMatrix([[...CITYPAK_COLUMNS], ...rows]);
  const cols = detectTrackingColumns(sheet.header)!;

  test("finds the Citypak columns", () => {
    expect(cols.reference).toBe(1);
    expect(cols.tracking).toBe(0);
    expect(cols.cod).toBe(24);
  });

  test("the 59-row sample reconciles as 59 new, 0 missing, 0 unknown", () => {
    const result = reconcileTracking(sheet, cols, manifestFor(rows), new Set());
    expect(result.counts.new).toBe(59);
    expect(result.counts.unknown + result.counts.missing + result.counts.duplicate).toBe(0);
    expect(result.apply).toHaveLength(59);
    expect(result.notInFile).toEqual([]);
    expect(blockingTracking(result)).toBe(0);
  });

  test("re-importing the same file applies nothing", () => {
    const manifest = manifestFor(rows).map((p, i) => ({ ...p, trackingNo: rows[i][0] }));
    const result = reconcileTracking(sheet, cols, manifest, new Set());
    expect(result.counts.same).toBe(59);
    expect(result.apply).toEqual([]);
  });

  test("conflicts, numbers used elsewhere, unknown references and duplicates block; differences only warn", () => {
    const manifest = manifestFor(rows);
    manifest[0] = { ...manifest[0], trackingNo: "D99999999" }; // different number already
    manifest[1] = { ...manifest[1], name: "Someone Else", cod: 0 };
    const extra = [...rows, [...rows[2]], ["D55555555", "27TGROCTICT999", ...rows[3].slice(2)]];
    const s = sheetFromMatrix([[...CITYPAK_COLUMNS], ...extra]);
    const result = reconcileTracking(s, cols, manifest, new Set([rows[4][0]]));
    const status = (ref: string) => result.rows.filter((r) => r.reference === ref).map((r) => r.status);
    expect(status(rows[0][1])).toEqual(["conflict"]);
    expect(status(rows[2][1])).toEqual(["duplicate", "duplicate"]);
    expect(status("27TGROCTICT999")).toEqual(["unknown"]);
    expect(status(rows[4][1])).toEqual(["used"]);
    const diff = result.rows.find((r) => r.reference === rows[1][1])!;
    expect(diff.status).toBe("new");
    expect(diff.differences.join(" ")).toMatch(/Name/);
    expect(diff.differences.join(" ")).toMatch(/COD/);
    expect(blockingTracking(result)).toBeGreaterThan(0);
  });

  test("parcels missing from the file are listed", () => {
    const manifest = [...manifestFor(rows), { ...manifestFor(rows)[0], id: "x", reference: `${PREFIX}200` }];
    expect(reconcileTracking(sheet, cols, manifest, new Set()).notInFile).toEqual([`${PREFIX}200`]);
  });
});

describe("waybill PDF text", () => {
  // The same reading order unpdf gives for a Citypak label.
  const label = (trk: string, ref: string) =>
    `PAICT TEST -\n9219\nReturn Address\n${trk}\nTO: Someone\nCOD\n500\nREFERENCE\n${ref}\n`;

  test("pairs each tracking number with the reference that follows it", () => {
    const text = label("D10000001", `${PREFIX}088`) + label("D10000002", `${PREFIX}089`);
    expect(pairsFromText(text, [PREFIX])).toEqual([
      { trackingNo: "D10000001", reference: `${PREFIX}088` },
      { trackingNo: "D10000002", reference: `${PREFIX}089` },
    ]);
  });

  test("checks labels against the manifest", () => {
    const manifest: ManifestParcel[] = [
      { id: "1", reference: `${PREFIX}088`, trackingNo: "D10000001", voided: false, name: "", phone1: null, city: "", cod: 0 },
      { id: "2", reference: `${PREFIX}089`, trackingNo: "D10000002", voided: false, name: "", phone1: null, city: "", cod: 0 },
      { id: "3", reference: `${PREFIX}090`, trackingNo: "D10000003", voided: false, name: "", phone1: null, city: "", cod: 0 },
    ];
    const text = label("D10000001", `${PREFIX}088`) + label("D10000002", `${PREFIX}090`) + label("D20000000", "OTHER1");
    const check = checkWaybills(pairsFromText(text, [PREFIX]), manifest);
    expect(check.labels).toBe(3);
    expect(check.matched).toBe(1);
    expect(check.mismatched).toEqual([{ trackingNo: "D10000002", reference: `${PREFIX}090` }]);
    expect(check.unknown).toEqual([{ trackingNo: "D20000000", reference: null }]);
    expect(check.missingLabels).toEqual([`${PREFIX}090`]);
  });
});

describe("round review", () => {
  const tutes = [
    { id: "t1", title: "Tute 5", shortCode: "T05", qty: 1, fromPapers: true },
    { id: "t2", title: "Tute 6", shortCode: "T06", qty: 2, fromPapers: false },
  ];
  const student = (no: string, over: Partial<ReviewStudent> = {}): ReviewStudent => ({
    id: no,
    studentNo: no,
    name: `S ${no}`,
    address: "1 Road",
    city: "Kandy",
    phone1: "0771234567",
    active: true,
    codAmount: null,
    excluded: [],
    ...over,
  });

  test("totals, COD and tute copies", () => {
    const r = reviewRound({
      prefix: PREFIX,
      defaultCod: 500,
      tutes,
      chosen: [student("088"), student("089", { excluded: ["t2"], codAmount: 0 })],
      notChosen: 3,
      usedReferences: new Set(),
    });
    expect(r).toMatchObject({ recipients: 2, parcels: 2, codTotal: 500, blocking: [], firstReference: `${PREFIX}088`, lastReference: `${PREFIX}089` });
    expect(r.tuteTotals).toEqual([
      { code: "T05", title: "Tute 5", parcels: 2, copies: 2 },
      { code: "T06", title: "Tute 6", parcels: 1, copies: 2 },
    ]);
    expect(r.warnings.join(" ")).toMatch(/3 active students are not in this round/);
    expect(r.warnings.join(" ")).toMatch(/T06/);
  });

  test("blocks on missing details, empty parcels and used references", () => {
    const r = reviewRound({
      prefix: PREFIX,
      defaultCod: 500,
      tutes,
      chosen: [
        student("088", { address: "" }),
        student("089", { phone1: null }),
        student("090", { excluded: ["t1", "t2"] }),
        student("091"),
      ],
      notChosen: 0,
      usedReferences: new Set([`${PREFIX}091`]),
    });
    expect(r.blocking).toHaveLength(4);
    expect(r.blocking.join(" ")).toMatch(/088/);
    expect(r.blocking.join(" ")).toMatch(/089/);
    expect(r.blocking.join(" ")).toMatch(/090/);
    expect(r.blocking.join(" ")).toMatch(/27TGROCTICT091/);
  });
});
