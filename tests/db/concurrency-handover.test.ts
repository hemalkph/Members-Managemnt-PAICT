// Handover and replacement races from independent sessions at the same moment.
import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";
import { handOver, verifiedRound } from "./dispatch-fixtures";

let owner: pg.Client;
let a: pg.Client;
let b: pg.Client;
let v1: Actor;
let v2: Actor;
let main: Actor;
let batch = "";

beforeAll(async () => {
  owner = await session();
  a = await session();
  b = await session();
  const edit = { dispatch: "edit" as const };
  v1 = { kind: "user", id: await createPerson(owner, { pageAccess: edit, grants: ["verify"] }), aal: "aal2" };
  v2 = { kind: "user", id: await createPerson(owner, { pageAccess: edit, grants: ["verify"] }), aal: "aal2" };
  main = { kind: "user", id: await createPerson(owner, { mainAdmin: true }), aal: "aal2" };
  batch = await createBatch(owner);
});
afterAll(async () => {
  await Promise.all([owner.end(), a.end(), b.end()]);
});

const settle = (ps: Promise<unknown>[]) => Promise.allSettled(ps);

test("two verifiers opening a handover at once get the same one", async () => {
  const { round } = await verifiedRound(owner, main, v1, batch, "RCHOPEN", 1);
  await actAs(a, v1);
  await actAs(b, v2);
  const [x, y] = await Promise.all([
    a.query("select public.handover_open($1) as id", [round]),
    b.query("select public.handover_open($1) as id", [round]),
  ]);
  expect(x.rows[0].id).toBe(y.rows[0].id);
});

test("the same parcel scanned by two verifiers at once is added once", async () => {
  const { round, parcels } = await verifiedRound(owner, main, v1, batch, "RCHSCAN", 1);
  await actAs(owner, v1);
  const h = (await owner.query("select public.handover_open($1) as id", [round])).rows[0].id;
  await actAs(a, v1);
  await actAs(b, v2);
  const results = await Promise.all([
    a.query("select public.handover_scan($1, $2) as r", [h, parcels[0].tracking]),
    b.query("select public.handover_scan($1, $2) as r", [h, parcels[0].reference]),
  ]);
  expect(results.map((r) => r.rows[0].r.result).sort()).toEqual(["duplicate", "ok"]);
  await asOwner(owner);
  const n = (await owner.query("select count(*)::int as n from public.handover_parcels where handover_id = $1", [h])).rows[0].n;
  expect(n).toBe(1);
});

test("confirming twice at once hands the parcels over once", async () => {
  const { round, parcels } = await verifiedRound(owner, main, v1, batch, "RCHCONF", 2);
  await actAs(owner, v1);
  const h = (await owner.query("select public.handover_open($1) as id", [round])).rows[0].id;
  for (const p of parcels) await owner.query("select public.handover_scan($1, $2)", [h, p.tracking]);
  await actAs(a, v1);
  await actAs(b, v2);
  const results = await settle([
    a.query("select public.handover_confirm($1, 2, '', '', '')", [h]),
    b.query("select public.handover_confirm($1, 2, '', '', '')", [h]),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  await asOwner(owner);
  const ev = (await owner.query("select count(*)::int as n from public.parcel_events where round_id = $1 and type = 'handed_over'", [round])).rows[0].n;
  expect(ev).toBe(2);
});

test("a scan racing a confirm either makes it into the count or is refused", async () => {
  const { round, parcels } = await verifiedRound(owner, main, v1, batch, "RCHMIX", 2);
  await actAs(owner, v1);
  const h = (await owner.query("select public.handover_open($1) as id", [round])).rows[0].id;
  await owner.query("select public.handover_scan($1, $2)", [h, parcels[0].tracking]);
  await actAs(a, v1);
  await actAs(b, v2);
  await settle([
    a.query("select public.handover_confirm($1, 1, '', '', '')", [h]),
    b.query("select public.handover_scan($1, $2)", [h, parcels[1].tracking]),
  ]);
  await asOwner(owner);
  // No parcel may sit in a confirmed handover without being handed over.
  const stray = (
    await owner.query(
      `select count(*)::int as n from public.handover_parcels hp join public.parcels p on p.id = hp.parcel_id
        where hp.handover_id = $1 and hp.released_at is null and p.delivery_state = 'awaiting_pickup'
          and (select state from public.handovers where id = $1) = 'confirmed'`,
      [h],
    )
  ).rows[0].n;
  expect(stray).toBe(0);
});

test("replacing the same parcel twice at once makes one replacement", async () => {
  const { round, parcels } = await verifiedRound(owner, main, v1, batch, "RCHRPL", 1);
  await handOver(owner, v1, round, parcels);
  await actAs(owner, main);
  await owner.query("select public.delivery_set($1::uuid[], 'returned', 'came back')", [[parcels[0].id]]);
  await actAs(a, main);
  await actAs(b, main);
  const results = await settle([
    a.query("select public.parcel_replace($1, 'resend', '{}'::jsonb)", [parcels[0].id]),
    b.query("select public.parcel_replace($1, 'resend', '{}'::jsonb)", [parcels[0].id]),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  await asOwner(owner);
  const n = (await owner.query("select count(*)::int as n from public.parcels where replaces_parcel_id = $1", [parcels[0].id])).rows[0].n;
  expect(n).toBe(1);
});
