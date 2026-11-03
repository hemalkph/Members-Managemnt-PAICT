// Past papers: Papers editors add a paper made before the system as already
// finished and handed over, so the marking team can log marking for it.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let main: Actor;
let member: Actor;

const add = async (who: Actor, title: string, part = "mcq") => {
  await actAs(db, who);
  return outcome(db, "select public.paper_add_past($1, $2, 'both', '2026-06-01')", [title, part]);
};

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  member = { kind: "user", id: await createPerson(db), aal: "aal2" };
});
afterAll(() => db.end());

describe("adding a past paper", () => {
  test("is saved finished and handed over, every stage skipped, no tasks", async () => {
    expect(await add(main, "Old RFP 01 - MCQ")).toBe("ok");
    await asOwner(db);
    const [p] = (
      await db.query(
        "select id, status, part, handed_over_at is not null as handed, completed_at is not null as finished from public.papers where title = 'Old RFP 01 - MCQ'",
      )
    ).rows;
    expect(p).toMatchObject({ status: "done", part: "mcq", handed: true, finished: true });
    const stages = (await db.query("select distinct status from public.paper_stages where paper_id = $1", [p.id])).rows;
    expect(stages).toEqual([{ status: "skipped" }]);
    const tasks = await db.query(
      "select 1 from public.tasks t join public.paper_stages s on s.id = t.paper_stage_id where s.paper_id = $1",
      [p.id],
    );
    expect(tasks.rows).toHaveLength(0);
  });

  test("members can see it (for Log marking)", async () => {
    await actAs(db, member);
    expect((await db.query("select 1 from public.papers where title = 'Old RFP 01 - MCQ'")).rows).toHaveLength(1);
  });

  test("the same name twice is refused", async () => {
    expect(await add(main, "old rfp 01 - mcq")).toBe("P0001");
  });

  test("only Papers editors can add one", async () => {
    expect(await add(member, "Old RFP 02 - MCQ")).toBe("42501");
  });

  test("anonymous visitors can't call it", async () => {
    await actAs(db, { kind: "anon" });
    expect(await outcome(db, "select public.paper_add_past('X paper', 'mcq', 'both')")).toBe("42501");
  });
});
