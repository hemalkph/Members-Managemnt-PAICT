// Phase 2 races, each from two independent sessions at the same time.
import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";
import { planRound, seedStudents, trackingFile } from "./dispatch-fixtures";

let owner: pg.Client;
let a: pg.Client;
let b: pg.Client;
let main1: Actor;
let main2: Actor;
let batch = "";

beforeAll(async () => {
  owner = await session();
  a = await session();
  b = await session();
  main1 = { kind: "user", id: await createPerson(owner, { mainAdmin: true }), aal: "aal2" };
  main2 = { kind: "user", id: await createPerson(owner, { mainAdmin: true }), aal: "aal2" };
  batch = await createBatch(owner);
});
afterAll(async () => {
  await Promise.all([owner.end(), a.end(), b.end()]);
});

const code = (r: PromiseSettledResult<unknown>) =>
  r.status === "fulfilled" ? "ok" : ((r.reason as { code?: string }).code ?? "error");

test("finalising the same round twice at once creates the parcels once", async () => {
  const students = await seedStudents(owner, batch, ["C01", "C02", "C03"]);
  const { round } = await planRound(owner, main1, batch, "RACEFIN", students);
  await actAs(a, main1);
  await actAs(b, main2);
  const results = await Promise.allSettled([
    a.query("select public.round_finalise($1)", [round]),
    b.query("select public.round_finalise($1)", [round]),
  ]);
  expect(results.map(code).sort()).toEqual(["P0001", "ok"]);
  await asOwner(owner);
  const { rows } = await owner.query("select count(*)::int as n from public.parcels where round_id = $1", [round]);
  expect(rows[0].n).toBe(3);
});

test("the same tracking numbers applied twice at once are registered once", async () => {
  const students = await seedStudents(owner, batch, ["D01", "D02"]);
  const { round } = await planRound(owner, main1, batch, "RACETRK", students);
  await actAs(owner, main1);
  await owner.query("select public.round_finalise($1)", [round]);
  const file = await trackingFile(owner, main1, round, "9");
  const rows = JSON.stringify([
    { reference: "RACETRKD01", tracking_no: "D60000001" },
    { reference: "RACETRKD02", tracking_no: "D60000002" },
  ]);
  await actAs(a, main1);
  await actAs(b, main2);
  const results = await Promise.all([
    a.query("select public.tracking_apply($1, $2, $3::jsonb) as r", [round, file, rows]),
    b.query("select public.tracking_apply($1, $2, $3::jsonb) as r", [round, file, rows]),
  ]);
  const outcomes = results.map((r) => r.rows[0].r).sort((x, y) => x.applied - y.applied);
  expect(outcomes).toEqual([
    { applied: 0, unchanged: 2 },
    { applied: 2, unchanged: 0 },
  ]);
  await asOwner(owner);
  const events = await owner.query("select count(*)::int as n from public.parcel_events where round_id = $1 and type = 'registered'", [round]);
  expect(events.rows[0].n).toBe(2);
});

test("two corrections from the same version: one wins, one is told to reload", async () => {
  const [s] = await seedStudents(owner, batch, ["E01"]);
  const { round } = await planRound(owner, main1, batch, "RACECOR", [s]);
  await actAs(owner, main1);
  await owner.query("select public.round_finalise($1)", [round]);
  const parcel = (await owner.query("select id, row_version from public.parcels where round_id = $1", [round])).rows[0];
  await actAs(a, main1);
  await actAs(b, main2);
  const fix = (c: pg.Client, cod: number) =>
    c.query("select public.parcel_correct($1, $2::jsonb, 'race test', $3)", [parcel.id, JSON.stringify({ cod_expected: cod }), parcel.row_version]);
  const results = await Promise.allSettled([fix(a, 100), fix(b, 200)]);
  expect(results.map(code).sort()).toEqual(["P0001", "ok"]);
  await asOwner(owner);
  const after = await owner.query("select row_version from public.parcels where id = $1", [parcel.id]);
  expect(after.rows[0].row_version).toBe(2);
});
