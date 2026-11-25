// Stage times: a start and due time per stage, kept in step with the dates.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let admin: Actor;
let plain: Actor;
let paperId = "";
let createId = "";
const stamp = Date.now();

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const colombo = async (stageId: string) =>
  (
    await q(
      `select start_date::text, due_date::text,
              to_char(start_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI') as start_local,
              to_char(due_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI') as due_local
       from public.paper_stages where id = $1`,
      [stageId],
    )
  )[0];

beforeAll(async () => {
  db = await session();
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  plain = { kind: "user", id: await createPerson(db), aal: "aal2" };
  const owner = await createPerson(db);
  await asOwner(db);
  paperId = (
    await q("insert into public.papers (title, exam_day) values ($1, '2026-12-09') returning id", [`Times ${stamp}`])
  )[0].id;
  createId = (
    await q(
      "insert into public.paper_stages (paper_id, stage, position, owner_id, status, start_date, due_date) values ($1, 'create_si', 1, $2, 'in_progress', '2026-11-30', '2026-12-03') returning id",
      [paperId, owner],
    )
  )[0].id;
  await q(
    "insert into public.paper_stages (paper_id, stage, position, status) values ($1, 'typeset_si', 2, 'waiting')",
    [paperId],
  );
  await q(
    "insert into public.tasks (title, assignee_id, due_date, status, paper_stage_id) values ('Create', $1, '2026-12-03', 'open', $2)",
    [owner, createId],
  );
});

afterAll(() => db.end());

const TIMES = JSON.stringify({
  create_si: { start_at: "2026-11-30T08:00:00+05:30", due_at: "2026-12-04T18:00:00+05:30" },
});

describe("stage times", () => {
  test("access", async () => {
    await actAs(db, plain);
    expect(await outcome(db, "select public.paper_stages_set_times($1, $2::jsonb)", [paperId, TIMES])).toBe("42501");
  });

  test("times set dates", async () => {
    await actAs(db, admin);
    expect((await q("select public.paper_stages_set_times($1, $2::jsonb) as n", [paperId, TIMES]))[0].n).toBe(1);
    await asOwner(db);
    expect(await colombo(createId)).toEqual({
      start_date: "2026-11-30",
      due_date: "2026-12-04",
      start_local: "2026-11-30 08:00",
      due_local: "2026-12-04 18:00",
    });
    expect((await q("select due_date::text as d from public.tasks where paper_stage_id = $1", [createId]))[0].d).toBe(
      "2026-12-04",
    );
  });

  test("date edit keeps time", async () => {
    await asOwner(db);
    await q("update public.paper_stages set due_date = '2026-12-05' where id = $1", [createId]);
    expect((await colombo(createId)).due_local).toBe("2026-12-05 18:00");
  });

  test("bad times", async () => {
    await actAs(db, admin);
    const bad = JSON.stringify({
      create_si: { start_at: "2026-12-05T08:00:00+05:30", due_at: "2026-12-01T18:00:00+05:30" },
    });
    expect(await outcome(db, "select public.paper_stages_set_times($1, $2::jsonb)", [paperId, bad])).toBe("P0001");
    expect(
      await outcome(db, "select public.paper_stages_set_times($1, $2::jsonb)", [
        paperId,
        '{"create_si":{"start_at":"x","due_at":"y"}}',
      ]),
    ).toBe("P0001");
  });
});
