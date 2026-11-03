// Packing station: a packer undoes their own pack within 2 minutes, nobody
// else's; the round's team list shows who packed and verified how many.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";
import { readyRound, type ReadyParcel } from "./dispatch-fixtures";

let db: pg.Client;
let main: Actor;
let packer: Actor;
let other: Actor;
let parcels: ReadyParcel[] = [];
let round = "";

const pack = async (who: Actor, p: ReadyParcel) => {
  await asOwner(db);
  const v = (await db.query("select row_version from public.parcels where id = $1", [p.id])).rows[0].row_version;
  await actAs(db, who);
  return (
    await db.query("select public.parcel_scan_confirm($1, 'pack', $2, $3, $4::uuid[], 'test') as r", [p.id, randomUUID(), v, p.items])
  ).rows[0].r;
};
const undo = async (who: Actor, p: ReadyParcel) => {
  await actAs(db, who);
  return outcome(db, "select public.parcel_undo_pack($1)", [p.id]);
};
const state = async (p: ReadyParcel) => {
  await asOwner(db);
  return (await db.query("select pack_state, packed_by from public.parcels where id = $1", [p.id])).rows[0];
};

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  packer = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["pack"], name: "Kushmi Packer" }), aal: "aal2" };
  other = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["pack"], name: "Other Packer" }), aal: "aal2" };
  ({ round, parcels } = await readyRound(db, main, await createBatch(db), "UNDOPFX", 3));
});
afterAll(() => db.end());

describe("undo a pack", () => {
  test("the packer undoes their own pack straight away", async () => {
    expect((await pack(packer, parcels[0])).result).toBe("ok");
    expect(await undo(packer, parcels[0])).toBe("ok");
    expect(await state(parcels[0])).toEqual({ pack_state: "planned", packed_by: null });
    await asOwner(db);
    const ev = await db.query("select type, source from public.parcel_events where parcel_id = $1 order by created_at desc limit 1", [parcels[0].id]);
    expect(ev.rows[0]).toEqual({ type: "unpacked", source: "scan" });
  });

  test("someone else can't undo it", async () => {
    expect((await pack(packer, parcels[1])).result).toBe("ok");
    expect(await undo(other, parcels[1])).toBe("P0001");
    expect((await state(parcels[1])).pack_state).toBe("packed");
  });

  test("after 2 minutes it is too late", async () => {
    await asOwner(db);
    await db.query("update public.parcels set packed_at = now() - interval '3 minutes' where id = $1", [parcels[1].id]);
    expect(await undo(packer, parcels[1])).toBe("P0001");
  });
});

describe("round team", () => {
  test("lists who packed how many", async () => {
    expect((await pack(other, parcels[2])).result).toBe("ok");
    await actAs(db, packer);
    const rows = (await db.query("select name, packed, verified from public.dispatch_round_team($1) order by name", [round])).rows;
    expect(rows).toEqual([
      { name: "Kushmi Packer", packed: 1, verified: 0 },
      { name: "Other Packer", packed: 1, verified: 0 },
    ]);
  });

  test("people without dispatch permissions see nobody", async () => {
    const outsider = { kind: "user" as const, id: await createPerson(db) };
    await actAs(db, outsider);
    expect((await db.query("select * from public.dispatch_round_team($1)", [round])).rows).toHaveLength(0);
  });
});
