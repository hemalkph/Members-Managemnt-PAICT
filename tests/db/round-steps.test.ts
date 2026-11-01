// Optional round steps: closing only waits for the steps the office uses.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";
import { readyRound } from "./dispatch-fixtures";

let db: pg.Client;
let main: Actor;
let packer: Actor;
let batch = "";

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  packer = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["pack"] }), aal: "aal2" };
  batch = await createBatch(db);
});
afterAll(() => db.end());

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const settings = async (p: object) => {
  await actAs(db, main);
  await q("select public.dispatch_settings_save($1::jsonb)", [JSON.stringify(p)]);
};

describe("round steps", () => {
  test("dependent steps are switched off together, and only main admins may change them", async () => {
    await settings({ optional_steps: ["delivery", "money"] });
    try {
      await asOwner(db);
      expect((await q("select optional_steps from public.dispatch_settings"))[0].optional_steps).toEqual([]);
      await settings({ optional_steps: ["money", "handover"] });
      await asOwner(db);
      expect((await q("select optional_steps from public.dispatch_settings"))[0].optional_steps).toEqual(["handover"]);
      await actAs(db, packer);
      await expect(db.query(`select public.dispatch_settings_save('{"optional_steps": []}'::jsonb)`)).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await settings({ optional_steps: ["handover", "delivery", "money"] });
    }
  });

  test("Plan → Tracking → Pack → Close: the round closes once every parcel is packed", async () => {
    const { round, parcels } = await readyRound(db, main, batch, "STEPS", 2);
    await settings({ optional_steps: [], require_verification: false });
    try {
      await actAs(db, main);
      await expect(db.query("select public.round_close($1, null)", [round])).rejects.toThrow(/2 parcel\(s\) are not packed yet/);
      for (const p of parcels) {
        await actAs(db, packer);
        await q("select public.parcel_scan_confirm($1, 'pack', $2, $3, $4::uuid[], 'dev')", [p.id, randomUUID(), p.row_version, p.items]);
      }
      await actAs(db, main);
      expect((await q("select public.round_close_check($1) as c", [round]))[0].c.can_close).toBe(true);
      await q("select public.round_close($1, 'done')", [round]);
      await asOwner(db);
      expect((await q("select state from public.dispatch_rounds where id = $1", [round]))[0].state).toBe("closed");
    } finally {
      await settings({ optional_steps: ["handover", "delivery", "money"], require_verification: true });
    }
  });

  test("with all steps on, packed parcels still block closing until delivered", async () => {
    const { round } = await readyRound(db, main, batch, "STEPA", 1);
    await actAs(db, main);
    const c = (await q("select public.round_close_check($1) as c", [round]))[0].c;
    expect(c.can_close).toBe(false);
    expect(c.blockers.join(" ")).toMatch(/not delivered or returned/);
  });
});
