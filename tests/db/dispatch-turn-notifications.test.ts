// People hear when their step of a round opens: courier after finalising,
// packers once tracking numbers are in, verifiers when every parcel is ready.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";
import { readyRound } from "./dispatch-fixtures";

let db: pg.Client;
let main: Actor;
let packer: Actor;
let courier = "";
let verifier: Actor;
let outsider = "";
let otherVerifier = "";
let round = "";

const kinds = async (user: string) => {
  await asOwner(db);
  return (
    await db.query(
      "select title, link from public.notifications where user_id = $1 and kind = 'dispatch.turn' and link like $2 order by created_at",
      [user, `%${round}%`],
    )
  ).rows.map((r) => r.title.split(":")[0]);
};

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  packer = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["pack"] }), aal: "aal2" };
  verifier = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["verify"] }), aal: "aal2" };
  courier = await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["courier"] });
  outsider = await createPerson(db, { pageAccess: { dispatch: "view" }, grants: [] });
  otherVerifier = await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["verify"] });
  await asOwner(db);
  await db.query("update public.dispatch_settings set require_verification = true");
  // The main admin plans, finalises and adds tracking; the packer packs, the verifier checks.
  const r = await readyRound(db, main, await createBatch(db), "TURNPFX", 2);
  round = r.round;
  for (const [who, action] of [
    [packer, "pack"],
    [verifier, "verify"],
  ] as const) {
    for (const p of r.parcels) {
      await asOwner(db);
      const v = (await db.query("select row_version from public.parcels where id = $1", [p.id])).rows[0].row_version;
      await actAs(db, who);
      const res = await db.query("select public.parcel_scan_confirm($1, $2, gen_random_uuid(), $3, $4::uuid[]) as r", [
        p.id,
        action,
        v,
        p.items,
      ]);
      expect(res.rows[0].r.result).toBe("ok");
    }
  }
});
afterAll(() => db.end());

describe("dispatch turn notifications", () => {
  test("courier hears the round is ready for tracking numbers", async () => {
    expect(await kinds(courier)).toEqual(["Add tracking numbers"]);
  });

  test("the packer hears packing can start, once", async () => {
    expect(await kinds((packer as { id: string }).id)).toEqual(["Packing can start"]);
  });

  test("verifiers hear when everything is ready for Citypak – not the one who finished it", async () => {
    expect(await kinds(otherVerifier)).toEqual(["Ready for Citypak"]);
    expect(await kinds((verifier as { id: string }).id)).toEqual([]);
  });

  test("people without the permission hear nothing", async () => {
    expect(await kinds(outsider)).toEqual([]);
  });
});
