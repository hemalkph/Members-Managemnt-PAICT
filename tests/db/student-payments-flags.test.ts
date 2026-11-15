// Payments and manual flags: admin-only, logged; Free cards have no payments.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let admin: Actor;
let viewer: Actor;
let marker: Actor;
let half = "";
let free = "";

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const pay = async (who: Actor, sid: string, month: string, status: string | null, amount: number | null = null) => {
  await actAs(db, who);
  return outcome(db, "select public.concession_payment_set($1, $2, $3, $4, null, '')", [sid, month, status, amount]);
};

beforeAll(async () => {
  db = await session();
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  viewer = { kind: "user", id: await createPerson(db, { admin: true, pageAccess: { students: "view" } }), aal: "aal2" };
  marker = { kind: "user", id: await createPerson(db, { pageAccess: { student_results: "edit" } }), aal: "aal2" };
  const batch = await createBatch(db);
  await actAs(db, admin);
  const add = async (no: string, card: string) =>
    (
      await q("select public.concession_student_save($1::jsonb) as id", [
        JSON.stringify({ student_no: no, full_name: `Student ${no}`, batch_id: batch, card_type: card }),
      ])
    )[0].id as string;
  half = await add(`H${Date.now()}`, "half");
  free = await add(`F${Date.now()}`, "free");
});
afterAll(() => db.end());

describe("payments", () => {
  test("an admin records a month; it is stored on the 1st and logged", async () => {
    expect(await pay(admin, half, "2026-10-17", "paid", 1500)).toBe("ok");
    await asOwner(db);
    const [row] = await q("select month::text, amount::text from public.concession_payments where student_id = $1", [half]);
    expect(row).toEqual({ month: "2026-10-01", amount: "1500.00" });
    expect(await q("select 1 from public.activity_log where action = 'student.payment_recorded' and entity_id = $1", [half])).toHaveLength(1);
  });

  test("paid needs an amount; Free cards and future months are refused", async () => {
    expect(await pay(admin, half, "2026-09-01", "paid", null)).toBe("P0001");
    expect(await pay(admin, free, "2026-10-01", "unpaid")).toBe("P0001");
    expect(await pay(admin, half, "2099-01-01", "unpaid")).toBe("P0001");
  });

  test("read-only admins and members can't record; members see nothing", async () => {
    expect(await pay(viewer, half, "2026-10-01", "unpaid")).toBe("42501");
    expect(await pay(marker, half, "2026-10-01", "unpaid")).toBe("42501");
    await actAs(db, marker);
    expect(await q("select 1 from public.concession_payments")).toHaveLength(0);
    await actAs(db, viewer);
    expect((await q("select 1 from public.concession_payments")).length).toBeGreaterThan(0);
  });

  test("clearing removes the record", async () => {
    expect(await pay(admin, half, "2026-10-01", null)).toBe("ok");
    await asOwner(db);
    expect(await q("select 1 from public.concession_payments where student_id = $1", [half])).toHaveLength(0);
  });
});

describe("flags", () => {
  test("raise and resolve, both logged; a flag is resolved once", async () => {
    await actAs(db, admin);
    const [{ id }] = await q("select public.concession_flag_raise($1, 'warning', 'Missed two classes') as id", [half]);
    expect(await outcome(db, "select public.concession_flag_resolve($1, 'Spoke to the parents')", [id])).toBe("ok");
    expect(await outcome(db, "select public.concession_flag_resolve($1, '')", [id])).toBe("P0001");
    await asOwner(db);
    const actions = (await q("select action from public.activity_log where entity_id = $1 and action like 'student.flag%' order by id", [half])).map((r) => r.action);
    expect(actions).toEqual(["student.flag_raised", "student.flag_resolved"]);
  });

  test("a reason is needed; members can't raise or see flags", async () => {
    await actAs(db, admin);
    expect(await outcome(db, "select public.concession_flag_raise($1, 'warning', '')", [half])).toBe("P0001");
    await actAs(db, marker);
    expect(await outcome(db, "select public.concession_flag_raise($1, 'top', 'Great marks')", [half])).toBe("42501");
    expect(await q("select 1 from public.concession_flags")).toHaveLength(0);
  });

  test("nobody writes the tables directly", async () => {
    await actAs(db, admin);
    expect(await outcome(db, "insert into public.concession_flags (student_id, kind, reason) values ($1, 'top', 'xyz')", [half])).toBe("42501");
    expect(await outcome(db, "insert into public.concession_payments (student_id, month, status) values ($1, '2026-08-01', 'unpaid')", [half])).toBe("42501");
  });
});

describe("result totals", () => {
  test("admins get totals; markers can't", async () => {
    await asOwner(db);
    const [{ batch_id }] = await q("select batch_id from public.concession_students where id = $1", [half]);
    const [{ id: exam }] = await q("insert into public.exams (batch_id, name, exam_date) values ($1, 'Unit Test', '2026-10-05') returning id", [batch_id]);
    const [{ id: part }] = await q("insert into public.exam_parts (exam_id, name, max_marks) values ($1, 'Paper', 50) returning id", [exam]);
    await actAs(db, admin);
    await q("select public.concession_results_save($1, $2::jsonb)", [exam, JSON.stringify([{ student_id: half, attendance: "present", marks: { [part]: "20" } }])]);
    const rows = await q("select total::text, max_total::text, parts_marked, parts from public.concession_result_totals('2026-10-01', '2026-10-31')");
    expect(rows).toContainEqual({ total: "20.00", max_total: "50.00", parts_marked: 1, parts: 1 });
    await actAs(db, marker);
    expect(await outcome(db, "select * from public.concession_result_totals('2026-10-01', '2026-10-31')")).toBe("42501");
  });
});
