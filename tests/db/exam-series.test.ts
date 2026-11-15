// Exam series: "Next exam" numbers the exams and gives them the series' parts;
// only Batches & exams editors manage series.
import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let editor: Actor;
let viewer: Actor;
let marker: Actor;
let batch = "";
let series = "";

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

beforeAll(async () => {
  db = await session();
  editor = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  viewer = {
    kind: "user",
    id: await createPerson(db, { admin: true, pageAccess: { classes: "view", student_results: "view" } }),
    aal: "aal2",
  };
  marker = { kind: "user", id: await createPerson(db, { pageAccess: { student_results: "edit" } }), aal: "aal2" };
  batch = await createBatch(db);
  await actAs(db, editor);
  [{ id: series }] = await q(
    `insert into public.exam_series (batch_id, name, code, default_parts)
     values ($1, 'Ranking Full Papers', 'RFP', '[{"name":"MCQ","max_marks":50},{"name":"SE & Essay","max_marks":100}]') returning id`,
    [batch],
  );
});
afterAll(() => db.end());

test("next exam: RFP 01, RFP 02, … each with MCQ and SE & Essay", async () => {
  await actAs(db, editor);
  await q("select public.exam_series_next($1, '2026-12-02')", [series]);
  const [{ id }] = await q("select public.exam_series_next($1) as id", [series]);
  await asOwner(db);
  expect(
    await q("select name, number, exam_date from public.exams where series_id = $1 order by number", [series]),
  ).toEqual([
    { name: "RFP 01", number: 1, exam_date: expect.any(Date) },
    { name: "RFP 02", number: 2, exam_date: null },
  ]);
  expect(
    await q("select name, max_marks::float as max from public.exam_parts where exam_id = $1 order by sort_order", [id]),
  ).toEqual([
    { name: "MCQ", max: 50 },
    { name: "SE & Essay", max: 100 },
  ]);
});

test("read-only admins and markers can't add series or exams", async () => {
  for (const who of [viewer, marker]) {
    await actAs(db, who);
    expect(await outcome(db, "select public.exam_series_next($1)", [series])).toBe("42501");
    expect(
      await outcome(db, "insert into public.exam_series (batch_id, name, code) values ($1, 'X', 'X')", [batch]),
    ).toBe("42501");
  }
  await actAs(db, { kind: "anon" });
  expect(await outcome(db, "select public.exam_series_next($1)", [series])).toBe("42501");
});

test("a series with exams can't be deleted; deleting the batch removes all", async () => {
  await actAs(db, editor);
  expect(await outcome(db, "delete from public.exam_series where id = $1", [series])).toBe("23503");
  await q("delete from public.batches where id = $1", [batch]);
  await asOwner(db);
  expect(await q("select 1 from public.exam_series where id = $1", [series])).toHaveLength(0);
});

test("Batches & exams editors can change exam parts too", async () => {
  await asOwner(db);
  const b = await createBatch(db);
  const [{ id: exam }] = await q("insert into public.exams (batch_id, name) values ($1, 'Term test') returning id", [
    b,
  ]);
  await actAs(db, editor);
  expect(
    await outcome(db, "insert into public.exam_parts (exam_id, name, max_marks) values ($1, 'Paper I', 40)", [exam]),
  ).toBe("ok");
  await actAs(db, viewer);
  expect(
    await outcome(db, "insert into public.exam_parts (exam_id, name, max_marks) values ($1, 'Paper II', 60)", [exam]),
  ).toBe("42501");
});
