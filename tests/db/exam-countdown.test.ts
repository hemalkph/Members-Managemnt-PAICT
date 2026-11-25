// Exam countdown: editable stage days, stage timing stats, and the heads-up
// to the next stage's owner when the stage before is late.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let admin: Actor;
let papersMember: Actor;
let plain: Actor;
let ownerA = "";
let ownerB = "";
const stamp = Date.now();
const TODAY = "(now() at time zone 'Asia/Colombo')::date";

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

async function paper(title: string) {
  await asOwner(db);
  return (await q("insert into public.papers (title, exam_day) values ($1, current_date + 7) returning id", [title]))[0]
    .id as string;
}

async function stage(paperId: string, name: string, position: number, extra: Record<string, unknown>) {
  const cols = ["paper_id", "stage", "position", ...Object.keys(extra)];
  const vals = [paperId, name, position, ...Object.values(extra)];
  await q(
    `insert into public.paper_stages (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    vals,
  );
}

beforeAll(async () => {
  db = await session();
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  papersMember = { kind: "user", id: await createPerson(db, { pageAccess: { papers: "edit" } }), aal: "aal2" };
  plain = { kind: "user", id: await createPerson(db), aal: "aal2" };
  ownerA = await createPerson(db);
  ownerB = await createPerson(db);
});

afterAll(() => db.end());

describe("exam countdown", () => {
  test("access", async () => {
    await actAs(db, plain);
    expect(await outcome(db, "select * from public.paper_stage_stats()")).toBe("42501");
    expect(await outcome(db, `select public.paper_stage_offsets_set('{}'::jsonb)`)).toBe("42501");
    await actAs(db, papersMember);
    expect(await outcome(db, "select * from public.paper_stage_stats()")).toBe("ok");
    expect(await outcome(db, "select public.paper_stage_offsets()")).toBe("ok");
    expect(await outcome(db, `select public.paper_stage_offsets_set('{}'::jsonb)`)).toBe("42501");
    await actAs(db, admin);
    expect(await outcome(db, "select public.send_stage_late_headsups()")).toBe("42501");
  });

  test("offsets validated", async () => {
    await actAs(db, admin);
    for (const bad of [
      { typeset_si: { start: -3, due: -4 } },
      { nope: { start: -1, due: 0 } },
      { typeset_si: { start: -40, due: -3 } },
      { typeset_si: { start: "x", due: -3 } },
    ]) {
      expect(await outcome(db, "select public.paper_stage_offsets_set($1::jsonb)", [JSON.stringify(bad)])).toBe(
        "P0001",
      );
    }
    await q("select public.paper_stage_offsets_set($1::jsonb)", [
      JSON.stringify({ typeset_si: { start: -6, due: -3 } }),
    ]);
    await actAs(db, papersMember);
    expect((await q("select public.paper_stage_offsets() as o"))[0].o).toEqual({ typeset_si: { start: -6, due: -3 } });
    await actAs(db, admin);
    await q("select public.paper_stage_offsets_set('{}'::jsonb)");
  });

  test("stats", async () => {
    await actAs(db, admin);
    const before = (await q("select * from public.paper_stage_stats() where stage = 'scheme_en'"))[0] ?? {
      done: 0,
      late: 0,
    };
    for (const [i, daysLate] of [0, 0, 3].entries()) {
      const id = await paper(`Stats ${stamp} ${i}`);
      await stage(id, "scheme_en", 10, {
        status: "done",
        due_date: "2026-10-10",
        started_at: "2026-10-07T09:00:00+05:30",
        completed_at: `2026-10-${String(10 + daysLate).padStart(2, "0")}T12:00:00+05:30`,
      });
    }
    await actAs(db, admin);
    const after = (await q("select * from public.paper_stage_stats() where stage = 'scheme_en'"))[0];
    expect(after.done - before.done).toBe(3);
    expect(after.late - before.late).toBe(1);
    expect(Number(after.avg_days_late)).toBeGreaterThanOrEqual(1);
  });

  test("headsup once, not to self", async () => {
    const title = `Countdown ${stamp}`;
    const id = await paper(title);
    await stage(id, "create_si", 1, { owner_id: ownerA, status: "in_progress", due_date: "2026-01-01" });
    await stage(id, "typeset_si", 2, { owner_id: ownerB, status: "waiting" });
    await q(`update public.paper_stages set due_date = ${TODAY} - 1 where paper_id = $1 and stage = 'create_si'`, [id]);
    await q("select public.send_stage_late_headsups()");
    const count = async (user: string) =>
      (
        await q(
          "select count(*)::int as n from public.notifications where user_id = $1 and kind = 'stage.before_late' and title like $2",
          [user, `%${title}%`],
        )
      )[0].n;
    expect(await count(ownerB)).toBe(1);
    expect(await count(ownerA)).toBe(0);
    await q("select public.send_stage_late_headsups()");
    expect(await count(ownerB)).toBe(1);
  });
});
