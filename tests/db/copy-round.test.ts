// Starting a round as a copy of an earlier one.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";
import { seedStudents } from "./dispatch-fixtures";

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

describe("copy a round", () => {
  test("copies tutes, students, COD and contents; leaves out students who left", async () => {
    const [a, b, gone] = await seedStudents(db, batch, ["801", "802", "803"]);
    await actAs(db, main);
    const from = (
      await q("select public.round_save($1::jsonb) as id", [
        JSON.stringify({ name: "October", batch_id: batch, sending_month: "2026-10-01", ref_prefix: "CPYOCT", default_cod: 500 }),
      ])
    )[0].id;
    await q("select public.round_set_tutes($1, $2::jsonb)", [
      from,
      JSON.stringify([
        { manual_title: "Main", short_code: "T1", qty_per_parcel: 2 },
        { manual_title: "Revision", short_code: "X1", is_extra: true },
      ]),
    ]);
    const [t1, x1] = (await q("select id from public.round_tutes where round_id = $1 order by sort_order", [from])).map((r) => r.id);
    await q("select public.round_set_students($1, $2::jsonb)", [
      from,
      JSON.stringify([
        { student_id: a, cod_amount: 0, note: "pays later", extra_tute_ids: [x1] },
        { student_id: b, excluded_tute_ids: [t1], extra_tute_ids: [x1] },
        { student_id: gone },
      ]),
    ]);
    await asOwner(db);
    await q("update public.students set is_active = false where id = $1", [gone]);

    const otherBatch = await createBatch(db);
    await actAs(db, main);
    const r = (
      await q("select public.round_copy($1, $2::jsonb) as r", [
        from,
        // A different batch is ignored: the copy keeps the earlier round's batch.
        JSON.stringify({ name: "November", batch_id: otherBatch, sending_month: "2026-11-01", ref_prefix: "CPYNOV", default_cod: 500 }),
      ])
    )[0].r;
    expect(r).toMatchObject({ tutes: 2, students: 2, skipped: 1 });

    await asOwner(db);
    const round = (await q("select batch_id, state, ref_prefix from public.dispatch_rounds where id = $1", [r.id]))[0];
    expect(round).toEqual({ batch_id: batch, state: "draft", ref_prefix: "CPYNOV" });
    const tutes = await q("select id, short_code, qty_per_parcel, is_extra from public.round_tutes where round_id = $1 order by sort_order", [r.id]);
    expect(tutes.map((t) => [t.short_code, t.qty_per_parcel, t.is_extra])).toEqual([["T1", 2, false], ["X1", 1, true]]);
    const students = await q(
      "select student_id, cod_amount::text, note, excluded_tute_ids, extra_tute_ids from public.round_students where round_id = $1",
      [r.id],
    );
    const byId = Object.fromEntries(students.map((s) => [s.student_id, s]));
    expect(byId[a]).toMatchObject({ cod_amount: "0.00", note: "pays later", excluded_tute_ids: [], extra_tute_ids: [tutes[1].id] });
    expect(byId[b]).toMatchObject({ excluded_tute_ids: [tutes[0].id], extra_tute_ids: [tutes[1].id] });
    expect(byId[gone]).toBeUndefined();

    // The copy finalises like any planned round.
    await actAs(db, main);
    expect((await q("select public.round_finalise($1) as n", [r.id]))[0].n).toBe(2);
  });

  test("only planners can copy", async () => {
    await actAs(db, main);
    const from = (
      await q("select public.round_save($1::jsonb) as id", [
        JSON.stringify({ name: "Src", batch_id: batch, sending_month: "2026-10-01", ref_prefix: "CPYSRC" }),
      ])
    )[0].id;
    await actAs(db, packer);
    await expect(
      db.query("select public.round_copy($1, $2::jsonb)", [from, JSON.stringify({ name: "X", sending_month: "2026-11-01", ref_prefix: "CPYX" })]),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
