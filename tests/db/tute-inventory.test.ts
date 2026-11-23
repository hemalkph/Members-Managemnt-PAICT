// Tute inventory (Phase 1): page access, insert-only stock moves, never below
// zero, opening stock + count fixes, print jobs (no double receive), alerts,
// safer catalog delete and the paid-list upload log.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let admin: Actor;
let editor: Actor;
let viewer: Actor;
let nobody: Actor;
let batch = "";
let classId = "";
let tuteId = "";
const stamp = Date.now();
const THIS_MONTH = "date_trunc('month', now() at time zone 'Asia/Colombo')::date";

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const onHand = async () =>
  (await q("select on_hand from public.tute_stock_summary($1, null) where tute_id = $2", [batch, tuteId]))[0].on_hand;

beforeAll(async () => {
  db = await session();
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  editor = { kind: "user", id: await createPerson(db, { pageAccess: { tutes: "edit" } }), aal: "aal2" };
  viewer = { kind: "user", id: await createPerson(db, { pageAccess: { tutes: "view" } }), aal: "aal2" };
  nobody = { kind: "user", id: await createPerson(db), aal: "aal2" };
  batch = await createBatch(db);

  await actAs(db, admin);
  classId = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `Theory ${stamp}`]))[0].id;
  tuteId = (
    await q(`select public.class_tute_create_and_assign($1, $2, $3, 'U07', array[${THIS_MONTH}]) as id`, [
      batch,
      classId,
      `Unit 07 ${stamp}`,
    ])
  )[0].id;
  // 30 students paid this month.
  await asOwner(db);
  await q(
    `insert into public.fee_month_imports (class_id, month, unique_student_count) values ($1, ${THIS_MONTH}, 30)`,
    [classId],
  );
});

afterAll(() => db.end());

describe("access", () => {
  test("needs the tutes page, edit access to change, and two-step sign-in", async () => {
    await actAs(db, nobody);
    expect(await outcome(db, "select * from public.tute_stock_summary($1, null)", [batch])).toBe("42501");
    expect(await q("select * from public.tute_stock_moves")).toEqual([]);

    await actAs(db, viewer);
    expect(await outcome(db, "select * from public.tute_stock_summary($1, null)", [batch])).toBe("ok");
    expect(await outcome(db, "select public.tute_stock_count($1, 5)", [tuteId])).toBe("42501");

    await actAs(db, { ...editor, aal: "aal1" } as Actor);
    expect(await outcome(db, "select * from public.tute_stock_summary($1, null)", [batch])).toBe("42501");

    // The tutes page can read the catalog without Fee reminders.
    await actAs(db, editor);
    expect((await q("select id from public.class_tutes where id = $1", [tuteId])).length).toBe(1);
  });

  test("stock moves can't be written, edited or deleted directly, even by admins", async () => {
    await actAs(db, admin);
    expect(
      await outcome(db, "insert into public.tute_stock_moves (tute_id, qty, kind) values ($1, 5, 'count_fix')", [tuteId]),
    ).toBe("42501");
    expect(await outcome(db, "update public.tute_stock_moves set qty = 1")).toBe("42501");
    expect(await outcome(db, "delete from public.tute_stock_moves")).toBe("42501");
  });
});

describe("stock", () => {
  test("starts out of stock with the class's paid count as the need", async () => {
    await actAs(db, editor);
    const [row] = await q("select * from public.tute_stock_summary($1, null) where tute_id = $2", [batch, tuteId]);
    expect(row).toMatchObject({ on_hand: 0, need_this: 30, given_this: 0, status: "out" });
    expect(row.classes).toMatchObject([{ id: classId, name: `Theory ${stamp}`, expected: 30, given: 0 }]);
  });

  test("first count is opening stock, later counts write the difference", async () => {
    await actAs(db, editor);
    expect((await q("select public.tute_stock_count($1, 10) as d", [tuteId]))[0].d).toBe(10);
    expect((await q("select public.tute_stock_count($1, 8) as d", [tuteId]))[0].d).toBe(-2);
    expect((await q("select public.tute_stock_count($1, 8) as d", [tuteId]))[0].d).toBe(0);
    const kinds = (await q("select kind, qty from public.tute_stock_moves where tute_id = $1 order by created_at", [tuteId])).map(
      (r) => `${r.kind}:${r.qty}`,
    );
    expect(kinds).toEqual(["opening_stock:10", "count_fix:-2"]);
    expect(await onHand()).toBe(8);
  });

  test("can't give out more than is on hand", async () => {
    await actAs(db, editor);
    expect(await outcome(db, "select public.tute_stock_issue($1, 9, 'class_issue', $2)", [tuteId, classId])).toBe("P0001");
    expect(await outcome(db, "select public.tute_stock_issue($1, 3, 'class_issue', null)", [tuteId])).toBe("P0001");
    expect(await onHand()).toBe(8);
  });

  test("a print job adds stock once, even if two people receive it at the same moment", async () => {
    await actAs(db, editor);
    const job = (await q("select public.tute_print_job_create($1, 40) as id", [tuteId]))[0].id;
    expect((await q("select in_print from public.tute_stock_summary($1, null) where tute_id = $2", [batch, tuteId]))[0].in_print).toBe(40);

    const other = await session();
    try {
      await actAs(other, editor);
      await db.query("begin");
      await db.query("select public.tute_print_job_receive($1, 40)", [job]);
      const late = outcome(other, "select public.tute_print_job_receive($1, 40)", [job]);
      await db.query("commit");
      expect(await late).toBe("P0001");
    } finally {
      await other.end();
    }
    expect(await onHand()).toBe(48);
    const [j] = await q("select status, received_qty from public.tute_print_jobs where id = $1", [job]);
    expect(j).toEqual({ status: "received", received_qty: 40 });
  });

  test("giving copies to a class counts toward this month's need", async () => {
    await actAs(db, editor);
    expect((await q("select public.tute_stock_issue($1, 25, 'class_issue', $2) as left", [tuteId, classId]))[0].left).toBe(23);
    const [row] = await q("select * from public.tute_stock_summary($1, null) where tute_id = $2", [batch, tuteId]);
    expect(row).toMatchObject({ on_hand: 23, given_this: 25, status: "ok" });
    expect(row.classes[0].given).toBe(25);
  });
});

describe("alerts", () => {
  test("running low notified people with the page, once", async () => {
    await asOwner(db);
    const rows = await q("select user_id from public.notifications where kind = 'tute.low' and title like $1", [
      `%Unit 07 ${stamp}`,
    ]);
    const people = rows.map((r) => r.user_id);
    expect(people).toContain(editor.kind === "user" ? editor.id : "");
    expect(people).toContain(viewer.kind === "user" ? viewer.id : "");
    expect(people).not.toContain(nobody.kind === "user" ? nobody.id : "");
    expect(new Set(people).size).toBe(people.length);
  });

  test("late print jobs are flagged once; people without the page can't trigger alerts", async () => {
    await actAs(db, editor);
    const job = (await q("select public.tute_print_job_create($1, 10, null, current_date - 2) as id", [tuteId]))[0].id;
    await q("select public.send_tute_stock_alerts($1)", [tuteId]);
    await q("select public.send_tute_stock_alerts($1)", [tuteId]);
    await asOwner(db);
    const late = await q("select count(*)::int as n from public.notifications where dedupe_key = $1 and user_id = $2", [
      `tute-job-late:${job}`,
      editor.kind === "user" ? editor.id : "",
    ]);
    expect(late[0].n).toBe(1);

    await actAs(db, nobody);
    expect((await q("select public.send_tute_stock_alerts() as n"))[0].n).toBe(0);
    expect(await outcome(db, "select public.tute_today()")).toBe("42501");

    await actAs(db, viewer);
    expect((await q("select public.tute_today() as t"))[0].t.late).toBeGreaterThanOrEqual(1);
  });
});

describe("catalog and upload log", () => {
  test("a tute with stock history can't be deleted", async () => {
    await actAs(db, admin);
    expect(await outcome(db, "select public.class_tute_delete($1)", [tuteId])).toBe("P0001");
  });

  test("every paid-list upload adds one log row", async () => {
    await asOwner(db);
    await q(
      `insert into public.fee_month_imports (class_id, month, unique_student_count) values ($1, ${THIS_MONTH}, 34)
       on conflict (class_id, month) do update set unique_student_count = excluded.unique_student_count, uploaded_at = now()`,
      [classId],
    );
    const counts = (
      await q("select student_count from public.fee_month_upload_log where class_id = $1 order by id", [classId])
    ).map((r) => r.student_count);
    expect(counts).toEqual([30, 34]);
  });
});
