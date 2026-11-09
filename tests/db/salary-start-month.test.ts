// Salary changes from a chosen month, and members paid from next month.
// Uses 2025 months so it never closes a month another test file closes.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let main: Actor;
let salaried = "";
let writer = "";

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  await asOwner(db);
  const section = (await q("insert into public.sections (name) values ('Start month test') returning id"))[0].id;
  salaried = (
    await q("insert into public.roles (section_id, name, is_salaried) values ($1, 'Coordinator', true) returning id", [section])
  )[0].id;
  writer = (await q("insert into public.roles (section_id, name) values ($1, 'Start writer') returning id", [section]))[0].id;
});
afterAll(() => db.end());

const giveSalary = async (user: string, rows: [string, number][]) => {
  await asOwner(db);
  await q("insert into public.member_roles (user_id, role_id) values ($1, $2) on conflict do nothing", [user, salaried]);
  for (const [from, amount] of rows) {
    await q("insert into public.member_salaries (user_id, role_id, monthly_amount, from_month) values ($1, $2, $3, $4)", [
      user,
      salaried,
      amount,
      from,
    ]);
  }
};
const close = async (month: string) => {
  await actAs(db, main);
  await q("select public.close_pay_month($1::date)", [month]);
};
const salaryPaid = async (month: string, user: string) => {
  await asOwner(db);
  const rows = await q("select salary_amount::text as s from public.payouts where month = $1 and user_id = $2", [month, user]);
  return rows[0]?.s ?? null;
};

describe("salary changes start from their month", () => {
  test("earlier months keep the old amount", async () => {
    const user = await createPerson(db);
    await giveSalary(user, [
      ["2025-01-01", 20000],
      ["2025-02-01", 30000],
    ]);
    await close("2025-01-01");
    await close("2025-02-01");
    expect(await salaryPaid("2025-01-01", user)).toBe("20000.00");
    expect(await salaryPaid("2025-02-01", user)).toBe("30000.00");
  });

  test("a change to 0 stops the salary from that month", async () => {
    const user = await createPerson(db);
    await giveSalary(user, [
      ["2025-03-01", 10000],
      ["2025-04-01", 0],
    ]);
    await close("2025-03-01");
    await close("2025-04-01");
    expect(await salaryPaid("2025-03-01", user)).toBe("10000.00");
    expect(await salaryPaid("2025-04-01", user)).toBeNull();
  });
});

describe("paid from next month", () => {
  test("the salary waits for the pay start month", async () => {
    const user = await createPerson(db);
    await giveSalary(user, [["2025-07-01", 15000]]);
    await asOwner(db);
    await q("insert into public.member_pay_starts (user_id, from_month) values ($1, '2025-09-01')", [user]);
    await close("2025-08-01");
    await close("2025-09-01");
    expect(await salaryPaid("2025-08-01", user)).toBeNull();
    expect(await salaryPaid("2025-09-01", user)).toBe("15000.00");
  });

  test("their work moves to next month, and new work goes there too", async () => {
    const id = await createPerson(db);
    const member: Actor = { kind: "user", id, aal: "aal1" };
    await asOwner(db);
    await q("insert into public.member_roles (user_id, role_id) values ($1, $2)", [id, writer]);
    const current = (await q("select public.open_pay_period(public.colombo_today())::text as m"))[0].m;
    const log = async () => {
      await actAs(db, member);
      return (
        await q(
          `insert into public.submissions (user_id, role_id, title, quantity, date_done)
           values ($1, $2, 'Paper set', 1, current_date) returning id`,
          [id, writer],
        )
      )[0].id as string;
    };
    const monthOf = async (sub: string) => {
      await asOwner(db);
      return (await q("select work_month::text as m from public.submissions where id = $1", [sub]))[0].m;
    };

    const before = await log();
    expect(await monthOf(before)).toBe(current);

    await actAs(db, main);
    const next = (await q("select public.set_member_pay_start($1, true)::text as m", [id]))[0].m;
    expect(next > current).toBe(true);
    expect(await monthOf(before)).toBe(next);
    expect(await monthOf(await log())).toBe(next);

    // Back to "this month": new work goes to the open month again.
    await actAs(db, main);
    await q("select public.set_member_pay_start($1, false)", [id]);
    expect(await monthOf(await log())).toBe(current);
  });

  test("members can't change their own pay start", async () => {
    const id = await createPerson(db);
    await actAs(db, { kind: "user", id, aal: "aal1" });
    expect(await outcome(db, "select public.set_member_pay_start($1, true)", [id])).toBe("42501");
    await actAs(db, { kind: "user", id, aal: "aal1" });
    expect(
      await outcome(db, "insert into public.member_pay_starts (user_id, from_month) values ($1, '2030-01-01')", [id]),
    ).toBe("42501");
  });
});
