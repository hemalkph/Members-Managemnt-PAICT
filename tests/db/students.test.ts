// Rules of the student register and the import save.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";

let db: pg.Client;
let planner: Actor;
let batch = "";

beforeAll(async () => {
  db = await session();
  planner = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["plan"] }), aal: "aal2" };
  batch = await createBatch(db);
});
afterAll(() => db.end());

async function newImport(rows = 1): Promise<string> {
  await asOwner(db);
  return (
    await db.query(
      `insert into public.student_imports (batch_id, file_name, sha256, size_bytes, row_count)
       values ($1, 'synthetic.xlsx', repeat('d', 64), 10, $2) returning id`,
      [batch, rows],
    )
  ).rows[0].id;
}

async function apply(imp: string, rows: unknown[]) {
  await actAs(db, planner);
  return db.query("select public.students_import_apply($1, $2::jsonb) as n", [imp, JSON.stringify(rows)]);
}

async function student(no: string) {
  await asOwner(db);
  // updated_at as text: a JS Date would drop the microseconds the import check compares.
  return (
    await db.query("select *, updated_at::text as updated_at from public.students where batch_id = $1 and student_no = $2", [batch, no])
  ).rows[0];
}

describe("import save", () => {
  test("keeps leading zeros and records counts and an activity entry", async () => {
    const imp = await newImport(2);
    const res = await apply(imp, [
      { action: "new", student_no: "007", full_name: "Zero Lead", phone1: "0771234567", phone1_raw: "771234567" },
      { action: "new", student_no: "0088", full_name: "Four Digits", city: "Kandy" },
    ]);
    expect(res.rows[0].n).toBe(2);
    expect((await student("007")).phone1).toBe("0771234567");
    expect(await student("0088")).toBeDefined();
    const log = await db.query("select count(*)::int as n from public.activity_log where action = 'dispatch.students_imported' and entity_id = $1", [imp]);
    expect(log.rows[0].n).toBe(1);
  });

  test("an update changes only the fields that were mapped", async () => {
    const before = await student("0088");
    const imp = await newImport();
    await apply(imp, [{ action: "update", student_no: "0088", address_line1: "12 New Road", expected_updated_at: before.updated_at }]);
    const after = await student("0088");
    expect(after.address_line1).toBe("12 New Road");
    expect(after.city).toBe("Kandy");
    expect(after.full_name).toBe("Four Digits");
  });

  test("a record changed after the preview stops the whole import (nothing partial is saved)", async () => {
    const imp = await newImport(2);
    await expect(
      apply(imp, [
        { action: "new", student_no: "500", full_name: "Should Not Stay" },
        { action: "update", student_no: "0088", full_name: "Stale", expected_updated_at: "2000-01-01T00:00:00Z" },
      ]),
    ).rejects.toMatchObject({ code: "P0001" });
    expect(await student("500")).toBeUndefined();
  });

  test("an import can be saved only once", async () => {
    const imp = await newImport();
    await apply(imp, [{ action: "new", student_no: "601", full_name: "Once" }]);
    await expect(apply(imp, [{ action: "new", student_no: "602", full_name: "Twice" }])).rejects.toMatchObject({
      message: expect.stringContaining("already saved"),
    });
  });

  test("more than 2,000 rows are refused", async () => {
    const imp = await newImport();
    const rows = Array.from({ length: 2001 }, (_, i) => ({ action: "new", student_no: `X${i}`, full_name: "Bulk" }));
    await expect(apply(imp, rows)).rejects.toMatchObject({ code: "P0001" });
  });

  test("a badly formatted phone number is refused by the database", async () => {
    const imp = await newImport();
    await expect(apply(imp, [{ action: "new", student_no: "701", full_name: "Bad Phone", phone1: "+94 77 123" }])).rejects.toMatchObject({
      code: "23514",
    });
  });
});

describe("single edits", () => {
  test("an anonymised student cannot be edited", async () => {
    await asOwner(db);
    const s = (
      await db.query(
        "insert into public.students (batch_id, student_no, full_name, anonymised_at) values ($1, '801', 'Student 801', now()) returning id",
        [batch],
      )
    ).rows[0];
    await actAs(db, planner);
    await expect(
      db.query("select public.student_save($1::jsonb)", [JSON.stringify({ id: s.id, student_no: "801", full_name: "Real Name" })]),
    ).rejects.toMatchObject({ code: "P0001" });
  });

  test("retention settings stay within their limits", async () => {
    await asOwner(db);
    await expect(db.query("update public.dispatch_settings set import_file_retention_days = 0 where id")).rejects.toMatchObject({
      code: "23514",
    });
  });
});
