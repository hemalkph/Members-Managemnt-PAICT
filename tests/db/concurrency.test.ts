// Real concurrency: independent sessions (separate backend processes) run the
// same operation at once. Each case must end with one success, one clean
// refusal, and no double writes.
import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";

let owner: pg.Client;
let a: pg.Client;
let b: pg.Client;
let planner1: Actor;
let planner2: Actor;
let main1: Actor;
let main2: Actor;
let batch = "";
let bPid = 0;

beforeAll(async () => {
  owner = await session();
  a = await session();
  b = await session();
  // Read before any test blocks b: a client runs its queries one at a time.
  bPid = (await b.query("select pg_backend_pid() as p")).rows[0].p;
  const edit = { dispatch: "edit" as const };
  planner1 = { kind: "user", id: await createPerson(owner, { pageAccess: edit, grants: ["plan"] }), aal: "aal2" };
  planner2 = { kind: "user", id: await createPerson(owner, { pageAccess: edit, grants: ["plan"] }), aal: "aal2" };
  main1 = { kind: "user", id: await createPerson(owner, { mainAdmin: true }), aal: "aal2" };
  main2 = { kind: "user", id: await createPerson(owner, { mainAdmin: true }), aal: "aal2" };
  batch = await createBatch(owner);
});
afterAll(async () => {
  await Promise.all([owner.end(), a.end(), b.end()]);
});

const pid = async (c: pg.Client) => (await c.query("select pg_backend_pid() as p")).rows[0].p as number;
const code = (r: PromiseSettledResult<unknown>) =>
  r.status === "fulfilled" ? "ok" : ((r.reason as { code?: string }).code ?? "error");

async function waitUntilBlocked(blockedPid: number) {
  for (let i = 0; i < 100; i++) {
    const { rows } = await owner.query("select wait_event_type from pg_stat_activity where pid = $1", [blockedPid]);
    if (rows[0]?.wait_event_type === "Lock") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("The second session never waited for the lock.");
}

test("the sessions are independent backends", async () => {
  expect(await pid(a)).not.toBe(await pid(b));
});

test("the same import applied by two people at once is saved exactly once", async () => {
  await asOwner(owner);
  const imp = (
    await owner.query(
      `insert into public.student_imports (batch_id, file_name, sha256, size_bytes, row_count)
       values ($1, 'race.xlsx', repeat('c', 64), 10, 2) returning id`,
      [batch],
    )
  ).rows[0].id;
  const rows = JSON.stringify([
    { action: "new", student_no: "201", full_name: "Race One" },
    { action: "new", student_no: "202", full_name: "Race Two" },
  ]);

  await actAs(a, planner1);
  await actAs(b, planner2);
  await a.query("begin");
  await a.query("select public.students_import_apply($1, $2::jsonb)", [imp, rows]);
  // b now waits for a's row lock on the import.
  const second = b.query("select public.students_import_apply($1, $2::jsonb)", [imp, rows]).then(
    () => "ok",
    (e: { code?: string; message: string }) => `${e.code}: ${e.message}`,
  );
  await waitUntilBlocked(bPid);
  await a.query("commit");
  expect(await second).toMatch(/^P0001: This import was already saved/);

  await asOwner(owner);
  const { rows: count } = await owner.query(
    "select count(*)::int as n from public.students where batch_id = $1 and student_no in ('201', '202')",
    [batch],
  );
  expect(count[0].n).toBe(2);
});

test("two edits of the same student from the same starting point: one wins, one is told to reload", async () => {
  await asOwner(owner);
  const s = (
    await owner.query(
      // updated_at as text: a JS Date would drop the microseconds the check compares.
      "insert into public.students (batch_id, student_no, full_name) values ($1, '301', 'Edit Race') returning id, updated_at::text as updated_at",
      [batch],
    )
  ).rows[0];
  await actAs(a, planner1);
  await actAs(b, planner2);
  const save = (c: pg.Client, name: string) =>
    c.query("select public.student_save($1::jsonb, $2)", [
      JSON.stringify({ id: s.id, student_no: "301", full_name: name }),
      s.updated_at,
    ]);
  const results = await Promise.allSettled([save(a, "Name A"), save(b, "Name B")]);
  expect(results.map(code).sort()).toEqual(["P0001", "ok"]);
});

test("two people adding the same student number at once: one is added, one is refused", async () => {
  await actAs(a, planner1);
  await actAs(b, planner2);
  const add = (c: pg.Client) =>
    c.query("select public.student_save($1::jsonb)", [JSON.stringify({ batch_id: batch, student_no: "401", full_name: "Dup" })]);
  const results = await Promise.allSettled([add(a), add(b)]);
  expect(results.map(code).sort()).toEqual(["23505", "ok"]);
});

test("two main admins giving the same permission at once leaves one active grant and one log entry", async () => {
  const target = await createPerson(owner, { pageAccess: { dispatch: "edit" } });
  await actAs(a, main1);
  await actAs(b, main2);
  const grant = (c: pg.Client) => c.query("select public.dispatch_grant($1, 'pack', 'race')", [target]);
  const results = await Promise.allSettled([grant(a), grant(b)]);
  expect(results.map(code)).toEqual(["ok", "ok"]);

  await asOwner(owner);
  const grants = await owner.query(
    "select count(*)::int as n from public.dispatch_grants where user_id = $1 and capability = 'pack' and revoked_at is null",
    [target],
  );
  const logs = await owner.query(
    "select count(*)::int as n from public.activity_log where action = 'dispatch.granted' and target_user_id = $1",
    [target],
  );
  expect(grants.rows[0].n).toBe(1);
  expect(logs.rows[0].n).toBe(1);
});
