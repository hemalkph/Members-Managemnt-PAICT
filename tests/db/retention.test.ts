// Nightly retention: anonymise parcel recipients and students, list old courier files.
import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";
import { deliveredRound, settle } from "./dispatch-fixtures";

let db: pg.Client;
let main: Actor;
let verifier: Actor;

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  verifier = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["verify"] }), aal: "aal2" };
});
afterAll(() => db.end());

const asService = async () => {
  await asOwner(db);
  await db.query("set role service_role");
};

test("only the service role can run retention", async () => {
  await actAs(db, main);
  expect(await outcome(db, "select public.dispatch_retention_run()")).toBe("42501");
  expect(await outcome(db, "select * from public.dispatch_retention_files()")).toBe("42501");
  await asOwner(db);
});

test("recipients and students are anonymised only after their time, files are listed for deletion", async () => {
  const batch = await createBatch(db);
  const { round, parcels } = await deliveredRound(db, main, verifier, batch, "RETA", 1);
  await settle(db, main, `RET-${Date.now()}`, [{ code: parcels[0].tracking }], 500);
  await actAs(db, main);
  await db.query("select public.round_close($1, '')", [round]);
  await asOwner(db);

  // Shortly after closing: nothing yet.
  await asService();
  const soon = (await db.query("select public.dispatch_retention_run(now() + interval '10 days') as r")).rows[0].r;
  await asOwner(db);
  const rec = () => db.query("select name, phone1, anonymised_at from public.parcel_recipients where parcel_id = $1", [parcels[0].id]).then((r) => r.rows[0]);
  expect((await rec()).anonymised_at).toBeNull();
  expect(soon.recipients).toBe(0);

  // After 181 days the recipient goes; the file list includes the round's tracking sheet.
  await asService();
  await db.query("select public.dispatch_retention_run(now() + interval '181 days')");
  const files = (await db.query("select f.id from public.dispatch_retention_files(now() + interval '181 days') f join public.carrier_files c on c.id = f.id where c.round_id = $1", [round])).rows;
  await asOwner(db);
  expect(await rec()).toMatchObject({ name: "Removed", phone1: null });
  expect(files.length).toBe(1);

  // Students of the batch after 12 months (the batch has no open round).
  const student = (await db.query("select student_id from public.parcels where id = $1", [parcels[0].id])).rows[0].student_id;
  await asService();
  await db.query("select public.dispatch_retention_run(now() + interval '13 months')");
  await asOwner(db);
  const s = (await db.query("select full_name, phone1, is_active, anonymised_at is not null as gone from public.students where id = $1", [student])).rows[0];
  expect(s).toEqual({ full_name: "Removed", phone1: null, is_active: false, gone: true });
  // The parcel itself, its reference and tracking number stay.
  expect((await db.query("select reference, tracking_no from public.parcels where id = $1", [parcels[0].id])).rows[0]).toEqual({
    reference: parcels[0].reference,
    tracking_no: parcels[0].tracking,
  });
});

test("students of a batch with an open round are kept", async () => {
  const batch = await createBatch(db);
  const closed = await deliveredRound(db, main, verifier, batch, "RETB", 1);
  await settle(db, main, `RETB-${Date.now()}`, [{ code: closed.parcels[0].tracking }], 500);
  await actAs(db, main);
  await db.query("select public.round_close($1, '')", [closed.round]);
  await deliveredRound(db, main, verifier, batch, "RETC", 1); // still active
  await asService();
  await db.query("select public.dispatch_retention_run(now() + interval '13 months')");
  await asOwner(db);
  const n = (await db.query("select count(*)::int as n from public.students where batch_id = $1 and anonymised_at is not null", [batch])).rows[0].n;
  expect(n).toBe(0);
});
