// The one-time move in migration 055, run on data shaped like the live data:
// "Ranking Full Papers" + "RFP" exams of 2027 A/L → one RFP series.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";
import { asOwner, createPerson, session } from "./helpers";

let db: pg.Client;
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const moveBlock = () => {
  const sql = readFileSync("supabase/migrations/20261207000055_exam_series.sql", "utf8");
  return sql.slice(sql.lastIndexOf("do $$"));
};

beforeAll(async () => {
  db = await session();
});
afterAll(() => db.end());

test("papers and tasks land on RFP 02–05 with their parts; paid work keeps its exam", async () => {
  // The move takes every untagged "RFP n" paper in the database, so other test
  // files' papers (e.g. "RFP 09 - MCQ") are hidden here, and it all rolls back.
  await db.query("begin");
  try {
    await moveTest();
  } finally {
    await db.query("rollback");
  }
});

async function moveTest() {
  const member = await createPerson(db);
  await asOwner(db);
  await q("update public.papers set title = 'other ' || title where title ~* '^\\s*RFP\\s*[0-9]' and exam_id is null");
  await q("delete from public.batches where name = '2027 A/L'");
  const [{ id: batch }] = await q("insert into public.batches (name) values ('2027 A/L') returning id");
  const [{ id: full }] = await q(
    "insert into public.exams (batch_id, name) values ($1, 'Ranking Full Papers') returning id",
    [batch],
  );
  const [{ id: rfp }] = await q("insert into public.exams (batch_id, name) values ($1, 'RFP') returning id", [batch]);
  await q("insert into public.exam_parts (exam_id, name, max_marks) values ($1, 'Paper I', 50)", [full]);

  const paper = async (title: string, exam: string | null, day: string, status = "in_progress") => {
    const [{ id }] = await q(
      `insert into public.papers (title, kind, exam_id, part, medium, exam_day, status) values ($1, 'paper', $2, 'full', 'both', $3, $4) returning id`,
      [title, exam, day, status],
    );
    const [{ id: stage }] = await q(
      "insert into public.paper_stages (paper_id, stage, position, status) values ($1, 'create_si', 1, 'in_progress') returning id",
      [id],
    );
    await q(
      "insert into public.tasks (title, assignee_id, exam_id, paper_stage_id, status) values ($1, $2, $3, $4, 'open')",
      [title, member, exam, stage],
    );
    return id as string;
  };
  const mcq4 = await paper("RFP 04 - MCQ", full, "2026-10-28");
  const essay4 = await paper("RFP 04 - SE & Essay", rfp, "2026-11-04");
  await paper("RFP 05 - MCQ", full, "2026-11-11");
  await paper("RFP 05 - SE & Essay", full, "2026-11-18");
  const done2 = await paper("RFP 02", null, "2026-10-14", "done");

  await q(moveBlock());
  await q(moveBlock()); // safe to run again

  const exams = await q(
    `select e.name, e.number, to_char(e.exam_date, 'YYYY-MM-DD') as date,
            (select string_agg(x.name || '/' || x.max_marks::int, ', ' order by x.sort_order) from public.exam_parts x where x.exam_id = e.id) as parts
     from public.exams e where e.batch_id = $1 order by e.number`,
    [batch],
  );
  expect(exams).toEqual([
    { name: "RFP 02", number: 2, date: "2026-10-14", parts: "MCQ/50, SE & Essay/100" },
    { name: "RFP 04", number: 4, date: "2026-10-28", parts: "MCQ/50, SE & Essay/100" },
    { name: "RFP 05", number: 5, date: "2026-11-11", parts: "MCQ/50, SE & Essay/100" },
  ]);
  const where = async (paperId: string) =>
    (
      await q(
        `select e.name as exam, p.part, (select t.exam_id = p.exam_id from public.tasks t join public.paper_stages s on s.id = t.paper_stage_id where s.paper_id = p.id) as task_moved
         from public.papers p join public.exams e on e.id = p.exam_id where p.id = $1`,
        [paperId],
      )
    )[0];
  expect(await where(mcq4)).toEqual({ exam: "RFP 04", part: "mcq", task_moved: true });
  expect(await where(essay4)).toEqual({ exam: "RFP 04", part: "essay", task_moved: true });
  expect(await where(done2)).toEqual({ exam: "RFP 02", part: "full", task_moved: true });
  // The two old exam rows are kept (renamed), so work tagged with them stays tagged.
  expect(
    (await q("select name from public.exams where id in ($1, $2) order by name", [rfp, full])).map((r) => r.name),
  ).toEqual(["RFP 04", "RFP 05"]);
}
