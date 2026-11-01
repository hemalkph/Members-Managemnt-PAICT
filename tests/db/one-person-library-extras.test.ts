// One-person mode (pack and verify by the same person), saved tutes, and
// extra tutes that go only to the chosen students.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";
import { readyRound, seedStudents } from "./dispatch-fixtures";

let db: pg.Client;
let main: Actor;
let packer: Actor;
let batch = "";

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  packer = {
    kind: "user",
    id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["pack", "verify"] }),
    aal: "aal2",
  };
  batch = await createBatch(db);
});
afterAll(() => db.end());

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

describe("one-person mode", () => {
  test("the packer can verify their own parcel only when the setting is on", async () => {
    const { round, parcels } = await readyRound(db, main, batch, "ONEP", 1);
    const p = parcels[0];
    const scan = async (mode: string, version: number) => {
      await actAs(db, packer);
      return (
        await q("select public.parcel_scan_confirm($1, $2, $3, $4, $5::uuid[], 'dev') as r", [p.id, mode, randomUUID(), version, p.items])
      )[0].r;
    };
    expect((await scan("pack", p.row_version)).result).toBe("ok");
    const v = (await q("select row_version from public.parcels where id = $1", [p.id]))[0].row_version;
    expect((await scan("verify", v)).result).toBe("blocked");

    // Only main admins may switch it on.
    await actAs(db, packer);
    await expect(db.query(`select public.dispatch_settings_save('{"allow_self_verify": true}'::jsonb)`)).rejects.toMatchObject({ code: "42501" });
    await actAs(db, main);
    await q(`select public.dispatch_settings_save('{"allow_self_verify": true}'::jsonb)`);
    try {
      expect((await scan("verify", v)).result).toBe("ok");
      await asOwner(db);
      expect((await q("select pack_state from public.parcels where id = $1", [p.id]))[0].pack_state).toBe("verified");
    } finally {
      await actAs(db, main);
      await q(`select public.dispatch_settings_save('{"allow_self_verify": false}'::jsonb)`);
    }
    expect(round).toBeTruthy();
  });
});

describe("saved tutes", () => {
  test("planners save, edit and archive; codes stay unique among active ones", async () => {
    await actAs(db, main);
    const id = (await q(`select public.dispatch_tute_save('{"title":"Tute 07","short_code":"lib07"}'::jsonb) as id`))[0].id;
    await expect(db.query(`select public.dispatch_tute_save('{"title":"Other","short_code":"LIB07"}'::jsonb)`)).rejects.toMatchObject({ code: "P0001" });
    await q("select public.dispatch_tute_save($1::jsonb)", [JSON.stringify({ id, title: "Tute 07 v2", short_code: "LIB07", qty_per_parcel: 2 })]);
    expect((await q("select title, short_code, qty_per_parcel from public.dispatch_tutes where id = $1", [id]))[0]).toEqual({
      title: "Tute 07 v2",
      short_code: "LIB07",
      qty_per_parcel: 2,
    });
    await q("select public.dispatch_tute_archive($1)", [id]);
    // The code is free again once archived.
    await q(`select public.dispatch_tute_save('{"title":"New 07","short_code":"LIB07"}'::jsonb)`);

    await actAs(db, packer);
    await expect(db.query(`select public.dispatch_tute_save('{"title":"X","short_code":"X1"}'::jsonb)`)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("extra tutes", () => {
  test("an extra tute goes only to the students who were given it", async () => {
    const [a, b] = await seedStudents(db, batch, ["701", "702"]);
    await actAs(db, main);
    const round = (
      await q("select public.round_save($1::jsonb) as id", [
        JSON.stringify({ name: "Extras", batch_id: batch, sending_month: "2026-11-01", ref_prefix: "EXTRA", default_cod: 0 }),
      ])
    )[0].id;
    await q("select public.round_set_tutes($1, $2::jsonb)", [
      round,
      JSON.stringify([
        { manual_title: "Main", short_code: "T1" },
        { manual_title: "Revision pack", short_code: "X1", is_extra: true },
      ]),
    ]);
    const [main1, extra] = (await q("select id from public.round_tutes where round_id = $1 order by sort_order", [round])).map((r) => r.id);

    // An extra tute can't be "excluded", and a normal one can't be an "extra".
    await expect(
      db.query("select public.round_set_students($1, $2::jsonb)", [round, JSON.stringify([{ student_id: a, excluded_tute_ids: [extra] }])]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      db.query("select public.round_set_students($1, $2::jsonb)", [round, JSON.stringify([{ student_id: a, extra_tute_ids: [main1] }])]),
    ).rejects.toMatchObject({ code: "P0001" });

    await q("select public.round_set_students($1, $2::jsonb)", [
      round,
      JSON.stringify([{ student_id: a, extra_tute_ids: [extra] }, { student_id: b }]),
    ]);
    expect((await q("select public.round_finalise($1) as n", [round]))[0].n).toBe(2);
    await asOwner(db);
    const items = await q(
      `select p.reference, array_agg(t.short_code order by t.sort_order) as codes
         from public.parcels p join public.parcel_items i on i.parcel_id = p.id join public.round_tutes t on t.id = i.round_tute_id
        where p.round_id = $1 group by p.reference order by p.reference`,
      [round],
    );
    expect(items).toEqual([
      { reference: "EXTRA701", codes: ["T1", "X1"] },
      { reference: "EXTRA702", codes: ["T1"] },
    ]);
  });

  test("a student with only an extra tute (main one excluded) still gets a parcel; none at all blocks", async () => {
    const [a] = await seedStudents(db, batch, ["711"]);
    await actAs(db, main);
    const round = (
      await q("select public.round_save($1::jsonb) as id", [
        JSON.stringify({ name: "Extras 2", batch_id: batch, sending_month: "2026-11-01", ref_prefix: "EXTRB", default_cod: 0 }),
      ])
    )[0].id;
    await q("select public.round_set_tutes($1, $2::jsonb)", [
      round,
      JSON.stringify([
        { manual_title: "Main", short_code: "T1" },
        { manual_title: "Extra", short_code: "X1", is_extra: true },
      ]),
    ]);
    const [main1, extra] = (await q("select id from public.round_tutes where round_id = $1 order by sort_order", [round])).map((r) => r.id);
    await q("select public.round_set_students($1, $2::jsonb)", [round, JSON.stringify([{ student_id: a, excluded_tute_ids: [main1] }])]);
    await expect(db.query("select public.round_finalise($1)", [round])).rejects.toThrow(/no tutes in the parcel/);

    // Giving them the extra tute makes it a valid parcel.
    await q("select public.round_set_students($1, $2::jsonb)", [
      round,
      JSON.stringify([{ student_id: a, excluded_tute_ids: [main1], extra_tute_ids: [extra] }]),
    ]);
    expect((await q("select public.round_finalise($1) as n", [round]))[0].n).toBe(1);
  });
});

describe("tute counts for the packing station", () => {
  test("copies needed and packed per tute, voided parcels left out", async () => {
    const { round, parcels } = await readyRound(db, main, batch, "CNT", 3);
    await actAs(db, packer);
    await q("select public.parcel_scan_confirm($1, 'pack', $2, $3, $4::uuid[], 'dev')", [
      parcels[0].id,
      randomUUID(),
      parcels[0].row_version,
      parcels[0].items,
    ]);
    await asOwner(db);
    await q("update public.parcels set registration_state = 'voided' where id = $1", [parcels[2].id]);
    await actAs(db, packer);
    const rows = await q("select short_code, parcels, copies, packed_parcels, packed_copies from public.dispatch_tute_counts($1)", [round]);
    expect(rows).toEqual([
      { short_code: "T05", parcels: 2, copies: 2, packed_parcels: 1, packed_copies: 1 },
      { short_code: "T06", parcels: 2, copies: 2, packed_parcels: 1, packed_copies: 1 },
    ]);
  });
});
