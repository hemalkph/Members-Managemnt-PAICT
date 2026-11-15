// CSV import: all or nothing, existing students / payments are skipped and
// never changed, everyone starts Applied, one activity log entry per import.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let admin: Actor;
let viewer: Actor;
let batch = "";
const stamp = Date.now();

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const student = (no: string, extra: Record<string, unknown> = {}) => ({
  student_no: no,
  full_name: `Student ${no}`,
  batch_id: batch,
  card_type: "half",
  monthly_amount: "1500",
  guardians: [{ relationship: "mother", full_name: "Kumari", occupation: "Teacher", phone: "0771234567" }],
  ...extra,
});
const importStudents = async (who: Actor, rows: unknown[]) => {
  await actAs(db, who);
  return db.query("select public.concession_students_import($1::jsonb, 'students.csv') as n", [JSON.stringify(rows)]);
};

beforeAll(async () => {
  db = await session();
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  viewer = { kind: "user", id: await createPerson(db, { admin: true, pageAccess: { students: "view" } }), aal: "aal2" };
  batch = await createBatch(db);
});
afterAll(() => db.end());

describe("students", () => {
  test("adds students as Applied, with parents, and logs once", async () => {
    const { rows } = await importStudents(admin, [student(`A${stamp}`), student(`B${stamp}`, { card_type: "free" })]);
    expect(rows[0].n).toBe(2);
    await asOwner(db);
    const added = await q("select status, card_type from public.concession_students where student_no in ($1, $2) order by student_no", [
      `A${stamp}`,
      `B${stamp}`,
    ]);
    expect(added).toEqual([
      { status: "applied", card_type: "half" },
      { status: "applied", card_type: "free" },
    ]);
    const [{ monthly_amount }] = await q(
      "select p.monthly_amount from public.concession_student_private p join public.concession_students s on s.id = p.student_id where s.student_no = $1",
      [`B${stamp}`],
    );
    expect(monthly_amount).toBeNull(); // a Free card keeps no amount
    expect(await q("select 1 from public.concession_guardians g join public.concession_students s on s.id = g.student_id where s.student_no = $1", [`A${stamp}`])).toHaveLength(1);
    expect(await q("select 1 from public.activity_log where action = 'student.imported' and actor_id = $1", [(admin as { id: string }).id])).toHaveLength(1);
  });

  test("an existing student ID is skipped and not changed", async () => {
    const { rows } = await importStudents(admin, [student(`A${stamp}`, { full_name: "Changed Name" }), student(`C${stamp}`)]);
    expect(rows[0].n).toBe(1);
    await asOwner(db);
    const [{ full_name }] = await q("select full_name from public.concession_students where student_no = $1", [`A${stamp}`]);
    expect(full_name).toBe(`Student A${stamp}`);
  });

  test("one bad row saves nothing, and names the row", async () => {
    await actAs(db, admin);
    const err = await db
      .query("select public.concession_students_import($1::jsonb, 'x.csv')", [
        JSON.stringify([student(`D${stamp}`), student(`E${stamp}`, { guardians: [{ relationship: "uncle", full_name: "X", occupation: "Y" }] })]),
      ])
      .catch((e: { message: string }) => e.message);
    expect(err).toMatch(/^Row 2 \(student ID E/);
    await asOwner(db);
    expect(await q("select 1 from public.concession_students where student_no = $1", [`D${stamp}`])).toHaveLength(0);
  });

  test("read-only admins can't import", async () => {
    await actAs(db, viewer);
    expect(await outcome(db, "select public.concession_students_import($1::jsonb, 'x.csv')", [JSON.stringify([student(`F${stamp}`)])])).toBe("42501");
  });
});

describe("payments", () => {
  test("adds payments, skips months already recorded, refuses Free cards", async () => {
    await asOwner(db);
    const [{ id: half }] = await q("select id from public.concession_students where student_no = $1", [`A${stamp}`]);
    const [{ id: free }] = await q("select id from public.concession_students where student_no = $1", [`B${stamp}`]);
    await actAs(db, admin);
    const pay = (month: string, status = "paid") => ({ student_id: half, month, status, amount: status === "paid" ? "1500" : "", paid_on: "", note: "" });

    const first = await q("select public.concession_payments_import($1::jsonb, 'p.csv') as n", [JSON.stringify([pay("2026-08-01"), pay("2026-09-01", "unpaid")])]);
    expect(first[0].n).toBe(2);
    const again = await q("select public.concession_payments_import($1::jsonb, 'p.csv') as n", [JSON.stringify([pay("2026-08-01", "unpaid"), pay("2026-10-01")])]);
    expect(again[0].n).toBe(1);
    await asOwner(db);
    const [{ status }] = await q("select status from public.concession_payments where student_id = $1 and month = '2026-08-01'", [half]);
    expect(status).toBe("paid"); // not changed by the second file

    await actAs(db, admin);
    expect(
      await outcome(db, "select public.concession_payments_import($1::jsonb, 'p.csv')", [
        JSON.stringify([{ ...pay("2026-07-01"), student_id: free }]),
      ]),
    ).toBe("P0001");
    expect(
      await outcome(db, "select public.concession_payments_import($1::jsonb, 'p.csv')", [JSON.stringify([pay("2099-01-01")])]),
    ).toBe("P0001");
  });
});
