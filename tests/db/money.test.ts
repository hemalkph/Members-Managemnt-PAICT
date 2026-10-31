// COD settlements, write-offs, closing/reopening rounds and reports.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";
import { deliveredRound, settle, verifiedRound } from "./dispatch-fixtures";

let db: pg.Client;
let main: Actor;
let verifier: Actor;
let finance: Actor;
let planner: Actor;
let batch = "";

beforeAll(async () => {
  db = await session();
  const edit = { dispatch: "edit" as const };
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  verifier = { kind: "user", id: await createPerson(db, { pageAccess: edit, grants: ["verify"] }), aal: "aal2" };
  finance = { kind: "user", id: await createPerson(db, { pageAccess: edit, grants: ["finance"], name: "Fiona Finance" }), aal: "aal2" };
  planner = { kind: "user", id: await createPerson(db, { pageAccess: edit, grants: ["plan"] }), aal: "aal2" };
  batch = await createBatch(db);
});
afterAll(() => db.end());

const one = async (actor: Actor, sql: string, params: unknown[] = []) => {
  await actAs(db, actor);
  return (await db.query(sql, params)).rows[0];
};
const cod = async (round: string) => {
  await actAs(db, finance);
  const rows = (await db.query("select reference, due, paid, fees, outstanding, status from public.dispatch_cod_rows($1)", [round])).rows;
  await asOwner(db);
  return Object.fromEntries(rows.map((r) => [r.reference, { ...r, due: Number(r.due), paid: Number(r.paid), fees: Number(r.fees), outstanding: Number(r.outstanding) }]));
};
const check = (round: string) => one(planner, "select public.round_close_check($1) as c", [round]).then((r) => r.c);
const ref = () => `CP-${Math.random().toString(36).slice(2, 8)}`;

describe("COD status", () => {
  test("delivered is owed but not paid; only a confirmed settlement pays", async () => {
    const { round, parcels } = await deliveredRound(db, main, verifier, batch, "CODA", 3);
    let s = await cod(round);
    expect(s[parcels[0].reference]).toMatchObject({ due: 500, paid: 0, outstanding: 500, status: "unpaid" });

    await actAs(db, finance);
    const id = (await db.query("select public.settlement_save(null, $1::jsonb) as id", [JSON.stringify({ reference: ref(), settled_on: "2026-11-20", remitted: 930 })])).rows[0].id;
    const added = (
      await db.query("select public.settlement_add_lines($1, $2::jsonb) as r", [
        id,
        JSON.stringify([{ code: parcels[0].tracking }, { code: parcels[1].reference, collected: 450, fee: 20 }, { code: "NOPE" }, { code: parcels[0].tracking }]),
      ])
    ).rows[0].r;
    expect(added.added).toBe(2);
    expect(added.problems.map((p: { message: string }) => p.message)).toEqual(["No parcel has this code.", "Already in this settlement."]);
    s = await cod(round);
    expect(s[parcels[0].reference]).toMatchObject({ paid: 0, status: "in_draft" });

    // 500 + 450 − 20 = 930
    await one(finance, "select public.settlement_confirm($1)", [id]);
    s = await cod(round);
    expect(s[parcels[0].reference]).toMatchObject({ paid: 500, outstanding: 0, status: "settled" });
    expect(s[parcels[1].reference]).toMatchObject({ paid: 450, fees: 20, outstanding: 50, status: "part_paid" });
    expect(s[parcels[2].reference].status).toBe("unpaid");
    await expect(one(finance, "select public.settlement_add_lines($1, '[]'::jsonb)", [id])).rejects.toMatchObject({ message: /confirmed/ });
  });

  test("a difference with what was remitted needs a dispute note", async () => {
    const { parcels } = await deliveredRound(db, main, verifier, batch, "CODB", 1);
    await expect(settle(db, finance, ref(), [{ code: parcels[0].tracking }], 480)).rejects.toMatchObject({ message: /Explain the difference/ });
    const id = (await db.query("select id from public.cod_settlement_lines where parcel_id = $1", [parcels[0].id])).rows[0];
    const sid = (await db.query("select settlement_id from public.cod_settlement_lines where parcel_id = $1", [parcels[0].id])).rows[0].settlement_id;
    expect(id).toBeTruthy();
    const r = await one(finance, "select public.settlement_confirm($1, 'Citypak kept 20 for a fee') as r", [sid]);
    expect(Number(r.r.difference)).toBe(-20);
    await asOwner(db);
    expect((await db.query("select state, dispute_note from public.cod_settlements where id = $1", [sid])).rows[0]).toEqual({
      state: "confirmed",
      dispute_note: "Citypak kept 20 for a fee",
    });
  });

  test("the same settlement reference can't be entered twice", async () => {
    const r = ref();
    await one(finance, "select public.settlement_save(null, $1::jsonb)", [JSON.stringify({ reference: r, settled_on: "2026-11-20", remitted: 0 })]);
    await expect(
      one(finance, "select public.settlement_save(null, $1::jsonb)", [JSON.stringify({ reference: ` ${r.toLowerCase()} `, settled_on: "2026-11-20", remitted: 0 })]),
    ).rejects.toMatchObject({ message: /already entered/ });
  });

  test("not-delivered parcels can't be added; paying a returned parcel shows as over", async () => {
    const { parcels } = await verifiedRound(db, main, verifier, batch, "CODC", 1);
    await actAs(db, finance);
    const id = (await db.query("select public.settlement_save(null, $1::jsonb) as id", [JSON.stringify({ reference: ref(), settled_on: "2026-11-20", remitted: 0 })])).rows[0].id;
    const r = (await db.query("select public.settlement_add_lines($1, $2::jsonb) as r", [id, JSON.stringify([{ code: parcels[0].tracking }])])).rows[0].r;
    expect(r.problems[0].message).toMatch(/not delivered/);

    const ret = await deliveredRound(db, main, verifier, batch, "CODD", 1);
    await one(main, "select public.delivery_set($1::uuid[], 'returned', 'came back')", [[ret.parcels[0].id]]);
    await settle(db, finance, ref(), [{ code: ret.parcels[0].tracking, collected: 500 }], 500);
    expect((await cod(ret.round))[ret.parcels[0].reference]).toMatchObject({ due: 0, paid: 500, outstanding: -500, status: "over" });
  });

  test("a shortfall can be written off with a reason, but not more than is owed", async () => {
    const { round, parcels } = await deliveredRound(db, main, verifier, batch, "CODE", 1);
    await settle(db, finance, ref(), [{ code: parcels[0].tracking, collected: 400 }], 400);
    await expect(one(finance, "select public.cod_writeoff_set($1, 100, '')", [parcels[0].id])).rejects.toMatchObject({ message: /reason/ });
    await expect(one(finance, "select public.cod_writeoff_set($1, 150, 'student paid less')", [parcels[0].id])).rejects.toMatchObject({ message: /Only Rs. 100/ });
    await one(finance, "select public.cod_writeoff_set($1, 100, 'student paid less')", [parcels[0].id]);
    expect((await cod(round))[parcels[0].reference]).toMatchObject({ outstanding: 0, status: "settled" });
  });

  test("cancelling a confirmed settlement needs the correct permission and un-pays the parcels", async () => {
    const { round, parcels } = await deliveredRound(db, main, verifier, batch, "CODF", 1);
    const id = await settle(db, finance, ref(), [{ code: parcels[0].tracking }], 500);
    await expect(one(finance, "select public.settlement_cancel($1, 'wrong file')", [id])).rejects.toMatchObject({ code: "42501" });
    await expect(one(main, "select public.settlement_cancel($1, '')", [id])).rejects.toMatchObject({ message: /reason/ });
    await one(main, "select public.settlement_cancel($1, 'wrong file')", [id]);
    expect((await cod(round))[parcels[0].reference].status).toBe("unpaid");
  });
});

describe("closing a round", () => {
  test("is blocked until every parcel is delivered or returned and the money is settled", async () => {
    const { round, parcels } = await deliveredRound(db, main, verifier, batch, "CLOSA", 2);
    let c = await check(round);
    expect(c.can_close).toBe(false);
    expect(c.blockers.join(" ")).toMatch(/still owe COD \(Rs. 1000/);
    await expect(one(planner, "select public.round_close($1, '')", [round])).rejects.toMatchObject({ message: /still owe COD/ });

    await settle(db, finance, ref(), [{ code: parcels[0].tracking }, { code: parcels[1].tracking }], 1000);
    // An open problem report doesn't block; it stays visible.
    await one(verifier, "select public.exception_open($1, 'other', 'note for the record')", [parcels[0].id]);
    c = await check(round);
    expect(c).toMatchObject({ can_close: true, delivered: 2, cod_expected: 1000, cod_paid: 1000, cod_outstanding: 0, open_exceptions: 1 });

    await expect(one(finance, "select public.round_close($1, '')", [round])).rejects.toMatchObject({ code: "42501" });
    await one(planner, "select public.round_close($1, 'all done')", [round]);
    const r = (await db.query("select state, close_note from public.dispatch_rounds where id = $1", [round])).rows[0];
    expect(r).toEqual({ state: "closed", close_note: "all done" });

    // Closed is read-only.
    await expect(one(main, "select public.delivery_set($1::uuid[], 'returned', 'late')", [[parcels[0].id]])).resolves.toMatchObject({});
    expect((await db.query("select delivery_state from public.parcels where id = $1", [parcels[0].id])).rows[0].delivery_state).toBe("delivered");
    await expect(one(finance, "select public.cod_writeoff_set($1, 0, '')", [parcels[0].id])).rejects.toMatchObject({ message: /closed/ });
  });

  test("unresolved parcels and an open handover block closing", async () => {
    const { round, parcels } = await verifiedRound(db, main, verifier, batch, "CLOSB", 2);
    await actAs(db, verifier);
    const h = (await db.query("select public.handover_open($1) as id", [round])).rows[0].id;
    await db.query("select public.handover_scan($1, $2)", [h, parcels[0].tracking]);
    const c = await check(round);
    expect(c.blockers.join(" ")).toMatch(/handover is still open/);
    expect(c.blockers.join(" ")).toMatch(/2 parcel\(s\) are not delivered/);
  });

  test("only a main admin can reopen, with a reason", async () => {
    const { round, parcels } = await deliveredRound(db, main, verifier, batch, "CLOSC", 1);
    await settle(db, finance, ref(), [{ code: parcels[0].tracking }], 500);
    await one(planner, "select public.round_close($1, '')", [round]);
    await expect(one(planner, "select public.round_reopen($1, 'mistake')", [round])).rejects.toMatchObject({ code: "42501" });
    await expect(one(main, "select public.round_reopen($1, '')", [round])).rejects.toMatchObject({ message: /reason/ });
    await one(main, "select public.round_reopen($1, 'Citypak sent a correction')", [round]);
    expect((await db.query("select state, closed_at from public.dispatch_rounds where id = $1", [round])).rows[0]).toEqual({ state: "active", closed_at: null });
  });
});

describe("reports", () => {
  test("round totals; money only for finance", async () => {
    const { round, parcels } = await deliveredRound(db, main, verifier, batch, "REPA", 2);
    await one(main, "select public.delivery_set($1::uuid[], 'returned', 'refused')", [[parcels[1].id]]);
    await settle(db, finance, ref(), [{ code: parcels[0].tracking, collected: 500, fee: 30 }], 470);
    const get = async (a: Actor) => {
      await actAs(db, a);
      const r = (await db.query("select * from public.dispatch_report_rounds('2026-11-01', '2026-11-30') where round_id = $1", [round])).rows[0];
      await asOwner(db);
      return r;
    };
    expect(await get(finance)).toMatchObject({ live: 2, delivered: 1, returned: 1, cod_expected: "500.00", cod_paid: "500.00", cod_fees: "30.00", cod_outstanding: "0.00" });
    expect(await get(planner)).toMatchObject({ delivered: 1, cod_expected: "500.00", cod_paid: null, cod_outstanding: null });
    await actAs(db, planner);
    const people = (await db.query("select * from public.dispatch_report_people('2026-11-01', '2026-11-30')")).rows;
    expect(people.length).toBeGreaterThan(0);
    await asOwner(db);
  });
});
