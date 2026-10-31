// Packing station rules: lookups, idempotent confirms, readiness gates,
// assignment, verification by a second person, problems and unpacking.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";
import { readyRound, type ReadyParcel } from "./dispatch-fixtures";

let db: pg.Client;
let main: Actor;
let packer: Actor;
let packer2: Actor;
let packerId = "";
let batch = "";

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true, name: "Main Admin" }), aal: "aal2" };
  packerId = await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["pack"], name: "Kushmi Packer" });
  packer = { kind: "user", id: packerId, aal: "aal2" };
  packer2 = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["pack", "verify"], name: "Second Packer" }), aal: "aal2" };
  batch = await createBatch(db);
});
afterAll(() => db.end());

const call = async (actor: Actor, sql: string, params: unknown[]) => {
  await actAs(db, actor);
  return (await db.query(sql, params)).rows[0];
};
const lookup = (actor: Actor, round: string, code: string, mode = "pack") =>
  call(actor, "select public.scan_lookup($1, $2, $3, 'test-device') as r", [round, code, mode]).then((r) => r.r);
const confirm = (actor: Actor, p: ReadyParcel, opts: { key?: string; version?: number; items?: string[]; mode?: string } = {}) =>
  call(actor, "select public.parcel_scan_confirm($1, $2, $3, $4, $5::uuid[], 'test-device') as r", [
    p.id,
    opts.mode ?? "pack",
    opts.key ?? randomUUID(),
    opts.version ?? p.row_version,
    opts.items ?? p.items,
  ]).then((r) => r.r);
const fresh = async (p: ReadyParcel) => {
  await asOwner(db);
  return { ...p, row_version: (await db.query("select row_version from public.parcels where id = $1", [p.id])).rows[0].row_version };
};

describe("looking up a scanned code", () => {
  let round = "";
  let parcels: ReadyParcel[] = [];
  beforeAll(async () => ({ round, parcels } = await readyRound(db, main, batch, "LOOKPFX", 2)));

  test("finds the parcel by tracking number or reference, without any address", async () => {
    const byTracking = await lookup(packer, round, ` ${parcels[0].tracking.toLowerCase()} `);
    expect(byTracking.result).toBe("ready");
    expect(byTracking.card.reference).toBe(parcels[0].reference);
    expect(byTracking.card.items).toHaveLength(2);
    expect(JSON.stringify(byTracking.card)).not.toMatch(/Test Road|0771234567/);
    expect((await lookup(packer, round, parcels[0].reference)).result).toBe("ready");
  });

  test("an unknown code and a parcel of another round are refused and recorded", async () => {
    expect((await lookup(packer, round, "NOT-A-CODE")).result).toBe("unknown");
    const other = await readyRound(db, main, batch, "OTHRPFX", 1);
    const wrong = await lookup(packer, round, other.parcels[0].tracking);
    expect(wrong.result).toBe("wrong_round");
    expect(wrong.message).toMatch(/Round OTHRPFX/);
    await asOwner(db);
    const scans = await db.query("select result from public.parcel_scans where round_id = $1 and action = 'lookup' order by created_at", [round]);
    expect(scans.rows.map((r) => r.result)).toEqual(["unknown", "wrong_round"]);
  });
});

describe("confirming", () => {
  let parcels: ReadyParcel[] = [];
  beforeAll(async () => ({ parcels } = await readyRound(db, main, batch, "PACKPFX", 4)));

  test("needs every tute ticked; then packs once and records who", async () => {
    const p = await fresh(parcels[0]);
    expect((await confirm(packer, p, { items: p.items.slice(0, 1) })).result).toBe("items");
    const ok = await confirm(packer, p);
    expect(ok).toMatchObject({ result: "ok", by: "Kushmi Packer", reference: p.reference });
    await asOwner(db);
    const row = (await db.query("select pack_state, packed_by from public.parcels where id = $1", [p.id])).rows[0];
    expect(row).toEqual({ pack_state: "packed", packed_by: packerId });
  });

  test("the same request key returns the first answer and changes nothing twice", async () => {
    const p = await fresh(parcels[1]);
    const key = randomUUID();
    const first = await confirm(packer, p, { key });
    const again = await confirm(packer, p, { key });
    expect(first.result).toBe("ok");
    expect(again).toMatchObject({ result: "ok", replayed: true });
    await asOwner(db);
    const events = await db.query("select count(*)::int as n from public.parcel_events where parcel_id = $1 and type = 'packed'", [p.id]);
    expect(events.rows[0].n).toBe(1);
  });

  test("a second confirm with a new key says who already packed it", async () => {
    const p = await fresh(parcels[1]);
    const dup = await confirm(packer2, p, { version: p.row_version });
    expect(dup.result).toBe("duplicate");
    expect(dup.message).toMatch(/Already packed by Kushmi Packer/);
  });

  test("a stale card is refused", async () => {
    const p = await fresh(parcels[2]);
    expect((await confirm(packer, p, { version: p.row_version - 1 })).result).toBe("changed");
  });

  test("a parcel without a tracking number can't be packed", async () => {
    await asOwner(db);
    await db.query("update public.parcels set registration_state = 'unregistered', tracking_no = null where id = $1", [parcels[3].id]);
    const p = await fresh(parcels[3]);
    expect((await confirm(packer, p)).result).toBe("not_ready");
  });
});

describe("assignment", () => {
  test("a packer can't pack a parcel assigned to someone else; planners can", async () => {
    const { round, parcels } = await readyRound(db, main, batch, "ASGNPFX", 2);
    await actAs(db, main);
    const n = (await db.query("select public.parcel_assign($1, $2::uuid[], $3) as n", [round, [parcels[0].id], (packer2 as { id: string }).id])).rows[0].n;
    expect(n).toBe(1);
    const p = await fresh(parcels[0]);
    expect((await confirm(packer, p)).result).toBe("not_assigned");
    expect((await confirm(main, p)).result).toBe("ok");
  });

  test("only people who can pack can be assigned", async () => {
    const { round, parcels } = await readyRound(db, main, batch, "ASG2PFX", 1);
    const noPack = await createPerson(db, { pageAccess: { dispatch: "edit" } });
    await actAs(db, main);
    await expect(db.query("select public.parcel_assign($1, $2::uuid[], $3)", [round, [parcels[0].id], noPack])).rejects.toMatchObject({
      message: /can't pack/,
    });
  });

  test("a packer's list shows their own and unassigned parcels only", async () => {
    const { round, parcels } = await readyRound(db, main, batch, "LISTPFX", 3);
    await actAs(db, main);
    await db.query("select public.parcel_assign($1, $2::uuid[], $3)", [round, [parcels[0].id], packerId]);
    await db.query("select public.parcel_assign($1, $2::uuid[], $3)", [round, [parcels[1].id], (packer2 as { id: string }).id]);
    await actAs(db, packer);
    const mine = (await db.query("select reference from public.dispatch_pack_list($1)", [round])).rows.map((r) => r.reference);
    expect(mine).toEqual([parcels[0].reference, parcels[2].reference]);
  });
});

describe("verification", () => {
  test("must be done by someone other than the packer", async () => {
    const { parcels } = await readyRound(db, main, batch, "VERIPFX", 1);
    let p = await fresh(parcels[0]);
    await confirm(packer2, p);
    p = await fresh(p);
    const self = await confirm(packer2, p, { mode: "verify" });
    expect(self.result).toBe("blocked");
    expect(self.message).toMatch(/someone else/);
    expect((await confirm(main, p, { mode: "verify" })).result).toBe("ok");
    await asOwner(db);
    expect((await db.query("select pack_state from public.parcels where id = $1", [p.id])).rows[0].pack_state).toBe("verified");
  });
});

describe("problems and unpacking", () => {
  test("a reported problem puts the parcel on hold until it is fixed", async () => {
    const { parcels } = await readyRound(db, main, batch, "HOLDPFX", 1);
    const eid = (await call(packer, "select public.exception_open($1, 'missing_item', 'T06 ran out') as id", [parcels[0].id])).id;
    let p = await fresh(parcels[0]);
    const held = await confirm(packer, p);
    expect(held).toMatchObject({ result: "not_ready" });
    expect(held.message).toMatch(/missing item/);
    await expect(call(packer, "select public.exception_resolve($1, 'fixed', 'printed more')", [eid])).rejects.toMatchObject({ code: "42501" });
    await call(main, "select public.exception_resolve($1, 'fixed', 'printed more')", [eid]);
    p = await fresh(p);
    expect((await confirm(packer, p)).result).toBe("ok");
  });

  test("unpacking needs the correct permission and a reason", async () => {
    const { parcels } = await readyRound(db, main, batch, "UNPKPFX", 1);
    let p = await fresh(parcels[0]);
    await confirm(packer, p);
    p = await fresh(p);
    await expect(call(packer2, "select public.parcel_unpack($1, 'wrong tute', $2)", [p.id, p.row_version])).rejects.toMatchObject({ code: "42501" });
    await expect(call(main, "select public.parcel_unpack($1, '', $2)", [p.id, p.row_version])).rejects.toMatchObject({ message: /reason/ });
    await call(main, "select public.parcel_unpack($1, 'wrong tute', $2)", [p.id, p.row_version]);
    await asOwner(db);
    const row = (await db.query("select pack_state, packed_by from public.parcels where id = $1", [p.id])).rows[0];
    expect(row).toEqual({ pack_state: "planned", packed_by: null });
  });
});
