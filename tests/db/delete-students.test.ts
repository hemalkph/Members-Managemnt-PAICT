// Deleting student details from the app: one student, or a whole batch.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";
import { deliveredRound, planRound, seedStudents, settle } from "./dispatch-fixtures";

let db: pg.Client;
let main: Actor;
let planner: Actor;
let verifier: Actor;

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  planner = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["plan"] }), aal: "aal2" };
  verifier = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["verify"] }), aal: "aal2" };
});
afterAll(() => db.end());

const batch = async (name: string) => {
  await asOwner(db);
  return (await db.query("insert into public.batches (name) values ($1) returning id", [name])).rows[0].id as string;
};
const count = async (sql: string, p: unknown[]) => {
  await asOwner(db);
  return (await db.query(sql, p)).rows[0].n as number;
};

describe("deleting one student", () => {
  test("planners can delete a student who is in no parcel, even if chosen in a draft", async () => {
    const b = await batch(`DS ${Date.now()}`);
    const [s1, s2] = await seedStudents(db, b, ["DSA1", "DSA2"]);
    await planRound(db, planner, b, "DSA", [s1]);
    await actAs(db, verifier);
    expect(await outcome(db, "select public.student_delete($1)", [s2])).toBe("42501");
    await actAs(db, planner);
    await db.query("select public.student_delete($1)", [s1]);
    expect(await count("select count(*)::int n from public.students where id = $1", [s1])).toBe(0);
    expect(await count("select count(*)::int n from public.round_students where student_id = $1", [s1])).toBe(0);
  });

  test("a student with a parcel can't be deleted", async () => {
    const b = await batch(`DS2 ${Date.now()}`);
    const r = await deliveredRound(db, main, verifier, b, "DSB", 1);
    const student = (await db.query("select student_id from public.parcels where id = $1", [r.parcels[0].id])).rows[0].student_id;
    await actAs(db, planner);
    await expect(db.query("select public.student_delete($1)", [student])).rejects.toMatchObject({ message: /Mark them inactive instead/ });
  });
});

describe("clearing a batch", () => {
  test("only a main admin, typing the exact batch name", async () => {
    const b = await batch(`Real ${Date.now()}`);
    await seedStudents(db, b, ["DSC1"]);
    await actAs(db, planner);
    expect(await outcome(db, "select public.dispatch_batch_clear($1, 'x')", [b])).toBe("42501");
    await actAs(db, main);
    await expect(db.query("select public.dispatch_batch_clear($1, 'wrong')", [b])).rejects.toMatchObject({ message: /Type the batch name/ });
  });

  test("a real batch without sent rounds loses its students and drafts", async () => {
    const name = `Real2 ${Date.now()}`;
    const b = await batch(name);
    const ids = await seedStudents(db, b, ["DSD1", "DSD2"]);
    await planRound(db, planner, b, "DSD", ids);
    await actAs(db, main);
    const r = (await db.query("select public.dispatch_batch_clear($1, $2) as r", [b, name])).rows[0].r;
    expect(r).toMatchObject({ students: 2, rounds: 1, parcels: 0, test: false });
    expect(await count("select count(*)::int n from public.students where batch_id = $1", [b])).toBe(0);
    expect(await count("select count(*)::int n from public.batches where id = $1", [b])).toBe(1);
  });

  test("a real batch with a sent round is refused", async () => {
    const name = `Real3 ${Date.now()}`;
    const b = await batch(name);
    await deliveredRound(db, main, verifier, b, "DSE", 1);
    await actAs(db, main);
    await expect(db.query("select public.dispatch_batch_clear($1, $2)", [b, name])).rejects.toMatchObject({ message: /sent rounds/ });
  });

  test("a TEST batch is wiped completely; other batches and history protection stay", async () => {
    const name = `TEST clear ${Date.now()}`;
    const b = await batch(name);
    const t = await deliveredRound(db, main, verifier, b, "DSF", 2);
    await settle(db, main, `DSF-${Date.now()}`, [{ code: t.parcels[0].tracking }], 500);
    const other = await deliveredRound(db, main, verifier, await batch(`Keep ${Date.now()}`), "DSG", 1);
    const otherEvents = await count("select count(*)::int n from public.parcel_events where round_id = $1", [other.round]);

    await actAs(db, main);
    const r = (await db.query("select public.dispatch_batch_clear($1, $2) as r", [b, name])).rows[0].r;
    expect(r).toMatchObject({ students: 2, rounds: 1, parcels: 2, settlements: 1, test: true });
    expect(r.files.some((f: string) => f.startsWith(`rounds/${t.round}/`))).toBe(true);
    expect(await count("select count(*)::int n from public.parcel_events where round_id = $1", [t.round])).toBe(0);
    expect(await count("select count(*)::int n from public.parcel_events where round_id = $1", [other.round])).toBe(otherEvents);
    // Outside the clear, history still can't be deleted.
    await asOwner(db);
    await expect(db.query("delete from public.parcel_events where round_id = $1", [other.round])).rejects.toMatchObject({
      message: /cannot be changed/,
    });
  });
});
