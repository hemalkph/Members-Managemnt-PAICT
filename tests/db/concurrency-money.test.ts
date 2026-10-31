// Money races from independent sessions at the same moment.
import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";
import { deliveredRound } from "./dispatch-fixtures";

let owner: pg.Client;
let a: pg.Client;
let b: pg.Client;
let main: Actor;
let verifier: Actor;
let f1: Actor;
let f2: Actor;
let batch = "";

beforeAll(async () => {
  owner = await session();
  a = await session();
  b = await session();
  const edit = { dispatch: "edit" as const };
  main = { kind: "user", id: await createPerson(owner, { mainAdmin: true }), aal: "aal2" };
  verifier = { kind: "user", id: await createPerson(owner, { pageAccess: edit, grants: ["verify"] }), aal: "aal2" };
  f1 = { kind: "user", id: await createPerson(owner, { pageAccess: edit, grants: ["finance"] }), aal: "aal2" };
  f2 = { kind: "user", id: await createPerson(owner, { pageAccess: edit, grants: ["finance"] }), aal: "aal2" };
  batch = await createBatch(owner);
});
afterAll(async () => {
  await Promise.all([owner.end(), a.end(), b.end()]);
});

const draft = async (c: pg.Client, who: Actor, reference: string) => {
  await actAs(c, who);
  return (await c.query("select public.settlement_save(null, $1::jsonb) as id", [JSON.stringify({ reference, settled_on: "2026-11-20", remitted: 500 })])).rows[0].id as string;
};

test("the same parcel added to two draft settlements at once goes into one", async () => {
  const { parcels } = await deliveredRound(owner, main, verifier, batch, "RCMA", 1);
  const s1 = await draft(a, f1, `RACE-A-${Date.now()}`);
  const s2 = await draft(b, f2, `RACE-B-${Date.now()}`);
  const rows = JSON.stringify([{ code: parcels[0].tracking }]);
  const [x, y] = await Promise.all([
    a.query("select public.settlement_add_lines($1, $2::jsonb) as r", [s1, rows]),
    b.query("select public.settlement_add_lines($1, $2::jsonb) as r", [s2, rows]),
  ]);
  expect([x.rows[0].r.added, y.rows[0].r.added].sort()).toEqual([0, 1]);
  await asOwner(owner);
  const n = (await owner.query("select count(*)::int as n from public.cod_settlement_lines where parcel_id = $1", [parcels[0].id])).rows[0].n;
  expect(n).toBe(1);
});

test("confirming the same settlement twice at once confirms it once", async () => {
  const { parcels } = await deliveredRound(owner, main, verifier, batch, "RCMB", 1);
  const s = await draft(a, f1, `RACE-C-${Date.now()}`);
  await a.query("select public.settlement_add_lines($1, $2::jsonb)", [s, JSON.stringify([{ code: parcels[0].tracking }])]);
  await actAs(b, f2);
  const results = await Promise.allSettled([a.query("select public.settlement_confirm($1)", [s]), b.query("select public.settlement_confirm($1)", [s])]);
  expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  await asOwner(owner);
  const ev = (await owner.query("select count(*)::int as n from public.parcel_events where parcel_id = $1 and type = 'cod_settled'", [parcels[0].id])).rows[0].n;
  expect(ev).toBe(1);
});
