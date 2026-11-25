// Days off: members mark days away; admins can for anyone; assigners see dates only.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let member: Actor;
let other: Actor;
let admin: Actor;
let assigner: Actor;
let memberId = "";
let otherId = "";
const TODAY = "(now() at time zone 'Asia/Colombo')::date";

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const add = (from: number, to: number, extra = "") =>
  `select public.day_off_add(${TODAY} + ${from}, ${TODAY} + ${to}${extra}) as id`;
const visible = async (who: Actor, userId: string) => {
  await actAs(db, who);
  return q(`select id, note from public.team_days_off(${TODAY}, ${TODAY} + 60) where user_id = $1`, [userId]);
};

beforeAll(async () => {
  db = await session();
  memberId = await createPerson(db);
  otherId = await createPerson(db);
  member = { kind: "user", id: memberId, aal: "aal2" };
  other = { kind: "user", id: otherId, aal: "aal2" };
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  assigner = { kind: "user", id: await createPerson(db, { pageAccess: { tasks: "edit" } }), aal: "aal2" };
});

afterAll(() => db.end());

describe("days off", () => {
  test("own days off", async () => {
    await actAs(db, member);
    await q(add(2, 4, ", 'Exam'"));
    expect(await visible(member, memberId)).toMatchObject([{ note: "Exam" }]);
  });

  test("past range refused", async () => {
    await actAs(db, member);
    expect(await outcome(db, add(-5, -2))).toBe("P0001");
  });

  test("too long refused", async () => {
    await actAs(db, member);
    expect(await outcome(db, add(10, 101))).toBe("P0001");
    expect(await outcome(db, add(12, 11))).toBe("P0001");
  });

  test("overlap refused", async () => {
    await actAs(db, member);
    expect(await outcome(db, add(3, 6))).toBe("P0001");
    expect(await outcome(db, add(5, 6))).toBe("ok");
  });

  test("only admins add for others", async () => {
    await actAs(db, member);
    expect(await outcome(db, add(20, 21, ", '', $1"), [otherId])).toBe("42501");
    await actAs(db, admin);
    expect(await outcome(db, add(20, 21, ", 'Wedding', $1"), [otherId])).toBe("ok");
  });

  test("notes stay private", async () => {
    expect((await visible(assigner, memberId)).map((r) => r.note)).toEqual(["", ""]);
    expect((await visible(admin, memberId)).map((r) => r.note)).toContain("Exam");
    expect(await visible(other, memberId)).toEqual([]);
    expect(await visible(other, otherId)).toMatchObject([{ note: "Wedding" }]);
  });

  test("delete", async () => {
    const [first, second] = await visible(member, memberId);
    await actAs(db, other);
    expect(await outcome(db, "select public.day_off_delete($1)", [first.id])).toBe("42501");
    await actAs(db, member);
    expect(await outcome(db, "select public.day_off_delete($1)", [first.id])).toBe("ok");
    await actAs(db, admin);
    expect(await outcome(db, "select public.day_off_delete($1)", [second.id])).toBe("ok");
    expect(await visible(member, memberId)).toEqual([]);
  });
});
