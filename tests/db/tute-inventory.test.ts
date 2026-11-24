// Tute inventory (Phase 1): page access, insert-only stock moves, never below
// zero, opening stock + count fixes, print jobs (no double receive), alerts,
// safer catalog delete and the paid-list upload log.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, createTute, outcome, session, type Actor } from "./helpers";

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
  (await q("select on_hand from public.tute_stock_summary(null) where tute_id = $1", [tuteId]))[0].on_hand;

beforeAll(async () => {
  db = await session();
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  editor = { kind: "user", id: await createPerson(db, { pageAccess: { tutes: "edit" } }), aal: "aal2" };
  viewer = { kind: "user", id: await createPerson(db, { pageAccess: { tutes: "view" } }), aal: "aal2" };
  nobody = { kind: "user", id: await createPerson(db), aal: "aal2" };
  batch = await createBatch(db);

  await actAs(db, admin);
  classId = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `Theory ${stamp}`]))[0].id;
  tuteId = await createTute(db, classId, `Unit 07 ${stamp}`, [THIS_MONTH], "U07");
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
    expect(await outcome(db, "select * from public.tute_stock_summary(null)")).toBe("42501");
    expect(await q("select * from public.tute_stock_moves")).toEqual([]);

    await actAs(db, viewer);
    expect(await outcome(db, "select * from public.tute_stock_summary(null)")).toBe("ok");
    expect(await outcome(db, "select public.tute_stock_count($1, 5)", [tuteId])).toBe("42501");

    await actAs(db, { ...editor, aal: "aal1" } as Actor);
    expect(await outcome(db, "select * from public.tute_stock_summary(null)")).toBe("42501");

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
  test("starts not counted with the class's paid count as the need", async () => {
    await actAs(db, editor);
    const [row] = await q("select * from public.tute_stock_summary(null) where tute_id = $1", [tuteId]);
    expect(row).toMatchObject({ on_hand: 0, need_this: 30, given_this: 0, status: "not_counted" });
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
    expect((await q("select in_print from public.tute_stock_summary(null) where tute_id = $1", [tuteId]))[0].in_print).toBe(40);

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
    const [row] = await q("select * from public.tute_stock_summary(null) where tute_id = $1", [tuteId]);
    expect(row).toMatchObject({ on_hand: 23, given_this: 25, status: "ok" });
    expect(row.classes[0].given).toBe(25);
    expect(row.classes[0].hall_given).toBe(25);
  });

  test("receiving a print job can record or preserve the invoice cost", async () => {
    await actAs(db, editor);
    const job = (await q("select public.tute_print_job_create($1, 10, null, null, 2500) as id", [tuteId]))[0].id;
    await q("select public.tute_print_job_receive($1, 5)", [job]);
    expect((await q("select cost::numeric::float8 as c from public.tute_print_jobs where id = $1", [job]))[0].c).toBe(2500);
    await q("select public.tute_print_job_receive($1, 5, 2750)", [job]);
    expect((await q("select cost::numeric::float8 as c from public.tute_print_jobs where id = $1", [job]))[0].c).toBe(2750);
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
  test("Tute stock edits a tute, links only a Paper Library tute, and deletes one never used", async () => {
    await asOwner(db);
    const paper = (await q("insert into public.papers (title, kind) values ($1, 'tute') returning id", [`Lib tute ${stamp}`]))[0].id;
    const notTute = (await q("insert into public.papers (title) values ($1) returning id", [`Lib paper ${stamp}`]))[0].id;
    const otherTute = (await q("insert into public.papers (title, kind) values ($1, 'tute') returning id", [`Other tute ${stamp}`]))[0].id;

    await actAs(db, editor);
    expect(await outcome(db, "select public.tute_save($1, 'Unit 07 Edited', 'U7', true, 40, 20, 25, $2)", [tuteId, notTute])).toBe("P0001");
    await q("select public.tute_save($1, $2, 'U7', true, 40, 20, 25, $3)", [tuteId, `Unit 07 Edited ${stamp}`, paper]);
    const [t] = await q("select name, code, pages, reorder_level, print_batch, paper_id from public.class_tutes where id = $1", [tuteId]);
    expect(t).toEqual({ name: `Unit 07 Edited ${stamp}`, code: "U7", pages: 40, reorder_level: 20, print_batch: 25, paper_id: paper });
    // Every Paper Library tute can be picked (tutes aren't per batch).
    expect((await q("select id from public.tute_paper_options()")).map((r) => r.id)).toEqual(
      expect.arrayContaining([paper, otherTute]),
    );

    const unused = (await q("select public.tute_save(null, $1) as id", [`Never used ${stamp}`]))[0].id;
    await q("select public.class_tute_delete($1)", [unused]);
    expect(await q("select id from public.class_tutes where id = $1", [unused])).toEqual([]);

    const withOpening = (
      await q("select public.tute_save(null, $1, 'OP', true, null, null, 1, null, 35) as id", [`Opening ${stamp}`])
    )[0].id;
    const openingMoves = await q("select kind, qty from public.tute_stock_moves where tute_id = $1", [withOpening]);
    expect(openingMoves).toEqual([{ kind: "opening_stock", qty: 35 }]);

    await actAs(db, viewer);
    expect(await outcome(db, "select public.tute_save(null, 'Viewer tute')")).toBe("42501");
  });

  test("a Paper Library tute needs no batch", async () => {
    await actAs(db, admin);
    const stages = JSON.stringify([]);
    const id = (
      await q(`select public.create_paper($1, 'tute', null, '', '${stages}'::jsonb, 'si', 'full', null) as id`, [`Any batch ${stamp}`])
    )[0].id;
    await asOwner(db);
    expect((await q("select kind, exam_id from public.papers where id = $1", [id]))[0]).toEqual({ kind: "tute", exam_id: null });
  });

  test("one tute serves classes in two batches, and its need adds up", async () => {
    const otherBatch = await createBatch(db);
    await actAs(db, admin);
    const otherClass = (await q("select public.fee_class_save(null, $1, $2, true) as id", [otherBatch, `Other ${stamp}`]))[0].id;
    await q(`select public.class_month_tute_attach($1, ${THIS_MONTH}, $2)`, [otherClass, tuteId]);
    await asOwner(db);
    await q(`insert into public.fee_month_imports (class_id, month, unique_student_count) values ($1, ${THIS_MONTH}, 12)`, [
      otherClass,
    ]);
    const expected = async (c: string) =>
      (await q(`select public.tute_expected_students($1, ${THIS_MONTH}) as n`, [c]))[0].n as number;
    const both = (await expected(classId)) + (await expected(otherClass));

    await actAs(db, admin);
    const [row] = await q(`select need_this, classes from public.tute_stock_summary(${THIS_MONTH}) where tute_id = $1`, [tuteId]);
    expect(row.need_this).toBe(both);
    expect(row.classes.map((c: { id: string; batch: string }) => c.id).sort()).toEqual([classId, otherClass].sort());
    expect(row.classes.every((c: { batch: string }) => c.batch.length > 0)).toBe(true);
  });

  test("a new tute is 'not counted' (not 'out') until its first count, even a count of 0", async () => {
    await actAs(db, admin);
    const fresh = await createTute(db, classId, `Fresh ${stamp}`, [THIS_MONTH], "FR");
    const status = async () =>
      (await q(`select status from public.tute_stock_summary(${THIS_MONTH}) where tute_id = $1`, [fresh]))[0].status;
    expect(await status()).toBe("not_counted");
    await asOwner(db);
    expect(await q("select * from public.tute_alert_state where tute_id = $1 and level <> 'ok'", [fresh])).toEqual([]);

    await actAs(db, admin);
    expect((await q("select public.tute_stock_count($1, 0) as n", [fresh]))[0].n).toBe(0);
    expect(await status()).toBe("out");
    await asOwner(db);
    expect((await q("select counted_at from public.class_tutes where id = $1", [fresh]))[0].counted_at).not.toBeNull();
  });

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

describe("editing open print jobs", () => {
  test("editor can edit open job, cannot shrink below received_qty, auto-closes when qty equals received_qty, and viewer is blocked", async () => {
    await actAs(db, editor);
    const printer = (await q("select public.tute_printer_save(null, $1, '0771234567', '', 4) as id", [`Press ${stamp}`]))[0].id;
    const job = (
      await q("select public.tute_print_job_create($1, 30, null, current_date + 5, 6000, 'initial') as id", [tuteId])
    )[0].id;

    // Viewer cannot edit print jobs.
    await actAs(db, viewer);
    expect(await outcome(db, "select public.tute_print_job_update($1, 40)", [job])).toBe("42501");

    // Editor updates qty, printer, due_date, cost, and note.
    await actAs(db, editor);
    await q("select public.tute_print_job_update($1, 40, $2, current_date + 7, 7500, 'updated note')", [job, printer]);
    const [updated] = await q(
      "select qty, printer_id, cost::numeric::float8 as cost, note, status from public.tute_print_jobs where id = $1",
      [job],
    );
    expect(updated).toEqual({ qty: 40, printer_id: printer, cost: 7500, note: "updated note", status: "planned" });

    // Receive partial delivery of 15 copies (job becomes 'printing').
    await q("select public.tute_print_job_receive($1, 15)", [job]);

    // Cannot shrink qty below received_qty (15).
    expect(await outcome(db, "select public.tute_print_job_update($1, 10, $2)", [job, printer])).toBe("P0001");

    // Shrinking qty down to received_qty (15) closes the job as 'received'.
    await q("select public.tute_print_job_update($1, 15, $2, null, 3000, 'final partial')", [job, printer]);
    const [closed] = await q(
      "select qty, received_qty, status, received_at, cost::numeric::float8 as cost from public.tute_print_jobs where id = $1",
      [job],
    );
    expect(closed.qty).toBe(15);
    expect(closed.received_qty).toBe(15);
    expect(closed.status).toBe("received");
    expect(closed.received_at).not.toBeNull();
    expect(closed.cost).toBe(3000);

    // Closed jobs can no longer be edited.
    expect(await outcome(db, "select public.tute_print_job_update($1, 20, $2)", [job, printer])).toBe("P0001");
  });
});

describe("tute cover images", () => {
  test("editor can set, replace, and clear a tute cover path; rejects path traversal and blocks viewers", async () => {
    const validPath = `${tuteId}/cover-1.webp`;
    const nextPath = `${tuteId}/cover-2.webp`;

    // Viewer cannot set cover.
    await actAs(db, viewer);
    expect(await outcome(db, "select public.tute_set_cover($1, $2)", [tuteId, validPath])).toBe("42501");

    // Editor cannot write a path outside the tute's folder or with traversal.
    await actAs(db, editor);
    expect(await outcome(db, "select public.tute_set_cover($1, $2)", [tuteId, "other/cover.webp"])).toBe("P0001");
    expect(await outcome(db, "select public.tute_set_cover($1, $2)", [tuteId, `${tuteId}/../evil.webp`])).toBe("P0001");

    // Set initial cover (returns null previous path).
    expect((await q("select public.tute_set_cover($1, $2) as old", [tuteId, validPath]))[0].old).toBeNull();
    expect((await q("select cover_path from public.class_tutes where id = $1", [tuteId]))[0].cover_path).toBe(validPath);

    // Replace cover (returns previous path so app can delete old file).
    expect((await q("select public.tute_set_cover($1, $2) as old", [tuteId, nextPath]))[0].old).toBe(validPath);
    expect((await q("select cover_path from public.class_tutes where id = $1", [tuteId]))[0].cover_path).toBe(nextPath);

    // Clear cover (returns replaced path and sets cover_path = null).
    expect((await q("select public.tute_set_cover($1, null) as old", [tuteId]))[0].old).toBe(nextPath);
    expect((await q("select cover_path from public.class_tutes where id = $1", [tuteId]))[0].cover_path).toBeNull();
  });
});
