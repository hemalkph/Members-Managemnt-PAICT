import { describe, expect, test } from "vitest";
import {
  checkPaymentRows,
  checkStudentRows,
  paymentTemplate,
  readDate,
  readMonth,
  readPhone,
  STUDENT_COLUMNS,
  studentTemplate,
} from "@/lib/students/import";

const BATCH = "11111111-1111-4111-8111-111111111111";
const CENTRE = "22222222-2222-4222-8222-222222222222";
const ctx = {
  batches: [{ id: BATCH, name: "2027 A/L" }],
  centres: [{ id: CENTRE, name: "Online" }],
  existing: [
    { id: "x", studentNo: "260009", fullName: "Old Student", batchName: "2027 A/L", centreName: null, card: "free" as const, status: "verified" as const },
  ],
};
const row = (over: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    student_id: "260001",
    full_name: "Nimal Perera",
    batch: "2027 a/l",
    centre: "online",
    card_type: "Half card",
    monthly_amount: "1,500",
    certificate_date: "15/11/2026",
    parent1_relationship: "Mother",
    parent1_name: "Kumari",
    parent1_occupation: "Teacher",
    parent1_phone: "771234567",
    ...over,
  };
  return STUDENT_COLUMNS.map((c) => values[c] ?? "");
};

describe("reading Excel's values", () => {
  test("dates, months and phones", () => {
    expect(readDate("2026-11-05")).toBe("2026-11-05");
    expect(readDate("5/11/2026")).toBe("2026-11-05");
    expect(readDate("31/02/2026")).toBeNull();
    expect(readDate("")).toBe("");
    expect(readMonth("2026-10")).toBe("2026-10");
    expect(readMonth("10/2026")).toBe("2026-10");
    expect(readMonth("05/10/2026")).toBe("2026-10");
    expect(readMonth("Oct")).toBeNull();
    expect(readPhone("771234567")).toBe("0771234567");
    expect(readPhone("+94 77 123 4567")).toBe("0771234567");
  });
});

describe("checkStudentRows", () => {
  test("a good row becomes a new student with its parent, matching names in any case", () => {
    const p = checkStudentRows([STUDENT_COLUMNS, row()], ctx);
    expect(p.fileError).toBeNull();
    expect(p.rows[0]).toMatchObject({
      kind: "new",
      payload: {
        student_no: "260001",
        batch_id: BATCH,
        centre_id: CENTRE,
        card_type: "half",
        monthly_amount: "1500",
        certificate_issued_on: "2026-11-15",
        guardians: [{ relationship: "mother", full_name: "Kumari", occupation: "Teacher", phone: "0771234567" }],
      },
    });
  });

  test("existing IDs are skipped and show what is in the system", () => {
    const p = checkStudentRows([STUDENT_COLUMNS, row({ student_id: "260009" })], ctx);
    expect(p.rows[0]).toMatchObject({ kind: "existing", existing: "Old Student · 2027 A/L · Free card · Verified" });
  });

  test("errors name the problem; duplicates in the file are caught", () => {
    const p = checkStudentRows(
      [STUDENT_COLUMNS, row(), row({ batch: "2026 AL", card_type: "gold", parent1_relationship: "uncle" }), row({ certificate_date: "Nov 15" })],
      ctx,
    );
    expect(p.rows[1]).toMatchObject({ kind: "error" });
    const errors = p.rows[1].kind === "error" ? p.rows[1].errors : [];
    expect(errors).toContain("Student ID 260001 is in the file twice");
    expect(errors).toContain('Batch "2026 AL" not found');
    expect(errors).toContain("card_type must be free, half or paid");
    expect(errors).toContain("Parent 1: relationship must be mother, father or guardian");
    expect(p.rows[2].kind === "error" && p.rows[2].errors).toContain("certificate_date: use YYYY-MM-DD, e.g. 2026-11-15");
  });

  test("the template's example row is ignored; missing columns stop the file", () => {
    expect(checkStudentRows(studentTemplate(), ctx)).toEqual({ fileError: null, rows: [], ignored: 1 });
    expect(checkStudentRows([["student_id", "name"]], ctx).fileError).toMatch(/full_name, batch, card_type/);
  });
});

describe("checkPaymentRows", () => {
  const students = [
    { id: "h", studentNo: "260001", fullName: "Nimal", card: "half" as const },
    { id: "f", studentNo: "260002", fullName: "Kamal", card: "free" as const },
  ];
  const pctx = { students, existing: new Map([["h:2026-08", { status: "paid" as const, amount: 1500 }]]), thisMonth: "2026-11" };
  const header = paymentTemplate()[0];

  test("new, already recorded and errors", () => {
    const p = checkPaymentRows(
      [
        header,
        ["260001", "10/2026", "Paid", "1500", "05/10/2026", ""],
        ["260001", "2026-08", "unpaid", "", "", ""],
        ["260002", "2026-10", "unpaid", "", "", ""],
        ["260001", "2026-12", "paid", "", "", ""],
        ["999", "2026-10", "paid", "10", "", ""],
      ],
      pctx,
    );
    expect(p.rows[0]).toMatchObject({ kind: "new", payload: { student_id: "h", month: "2026-10", status: "paid", amount: "1500", paid_on: "2026-10-05" } });
    expect(p.rows[1]).toMatchObject({ kind: "existing", existing: "Paid Rs. 1,500" });
    expect(p.rows[2].kind === "error" && p.rows[2].errors).toEqual(["A Free card student pays nothing"]);
    expect(p.rows[3].kind === "error" && p.rows[3].errors).toEqual(["The month is in the future", "Enter the amount paid in rupees"]);
    expect(p.rows[4].kind === "error" && p.rows[4].errors).toEqual(['Student ID "999" is not registered']);
  });
});
