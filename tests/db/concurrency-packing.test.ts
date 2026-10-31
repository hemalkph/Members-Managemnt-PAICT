// Packing races from independent sessions at the same moment.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";
import { readyRound } from "./dispatch-fixtures";

let owner: pg.Client;
let a: pg.Client;
let b: pg.Client;
let packer1: Actor;
let packer2: Actor;
let main: Actor;
let batch = "";

beforeAll(async () => {
  owner = await session();
  a = await session();
  b = await session();
  const edit = { dispatch: "edit" as const };
  packer1 = { kind: "user", id: await createPerson(owner, { pageAccess: edit, grants: ["pack"] }), aal: "aal2" };
  packer2 = { kind: "user", id: await createPerson(owner, { pageAccess: edit, grants: ["pack"] }), aal: "aal2" };
  main = { kind: "user", id: await createPerson(owner, { mainAdmin: true }), aal: "aal2" };
  batch = await createBatch(owner);
});
afterAll(async () => {
  await Promise.all([owner.end(), a.end(), b.end()]);
});

const confirm = (c: pg.Client, p: { id: string; row_version: number; items: string[] }, key: string) =>
  c
    .query("select public.parcel_scan_confirm($1, 'pack', $2, $3, $4::uuid[]) as r", [p.id, key, p.row_version, p.items])
    .then((r) => r.rows[0].r);

test("two packers confirming the same parcel at once: one packs it, the other is told it is already packed", async () => {
  const { parcels } = await readyRound(owner, main, batch, "RACEPK", 1);
  await actAs(a, packer1);
  await actAs(b, packer2);
  const results = await Promise.all([confirm(a, parcels[0], randomUUID()), confirm(b, parcels[0], randomUUID())]);
  expect(results.map((r) => r.result).sort()).toEqual(["duplicate", "ok"]);
  await asOwner(owner);
  const events = await owner.query("select count(*)::int as n from public.parcel_events where parcel_id = $1 and type = 'packed'", [parcels[0].id]);
  expect(events.rows[0].n).toBe(1);
});

test("the same request key sent from two sessions at once gives one result, stored once", async () => {
  const { parcels } = await readyRound(owner, main, batch, "RACEKY", 1);
  const key = randomUUID();
  await actAs(a, packer1);
  await actAs(b, packer1);
  const results = await Promise.all([confirm(a, parcels[0], key), confirm(b, parcels[0], key)]);
  expect(results.map((r) => r.result)).toEqual(["ok", "ok"]);
  expect(results.filter((r) => r.replayed).length).toBe(1);
  await asOwner(owner);
  const scans = await owner.query("select count(*)::int as n from public.parcel_scans where idempotency_key = $1", [key]);
  const events = await owner.query("select count(*)::int as n from public.parcel_events where parcel_id = $1 and type = 'packed'", [parcels[0].id]);
  expect(scans.rows[0].n).toBe(1);
  expect(events.rows[0].n).toBe(1);
});
