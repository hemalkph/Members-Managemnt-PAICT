// Pay periods: a month runs 11th → 10th, the database decides each work's
// month, and closing moves work that isn't approved on to the next month.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, session, type Actor } from "./helpers";

let db: pg.Client;
let main: Actor;
let member: Actor;
let role = "";
let current = ""; // the open month today, "YYYY-MM-DD"

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  const memberId = await createPerson(db);
  member = { kind: "user", id: memberId, aal: "aal1" };
  await asOwner(db);
  const section = (await db.query("insert into public.sections (name) values ('Pay test') returning id")).rows[0].id;
  role = (await db.query("insert into public.roles (section_id, name) values ($1, 'Writer') returning id", [section])).rows[0].id;
  await db.query("insert into public.member_roles (user_id, role_id) values ($1, $2)", [memberId, role]);
  current = (await db.query("select public.open_pay_period(public.colombo_today())::text as m")).rows[0].m;
});
afterAll(() => db.end());

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const monthOf = async (id: string) => {
  await asOwner(db);
  return (await q("select work_month::text as m from public.submissions where id = $1", [id]))[0].m as string;
};
/** Member logs work, asking for some other month (ignored). */
const logWork = async (asked = "2020-01-01") => {
  await actAs(db, member);
  return (
    await q(
      `insert into public.submissions (user_id, role_id, work_month, title, quantity, date_done)
       values ($1, $2, $3, 'Paper set', 1, current_date) returning id`,
      [(member as { id: string }).id, role, asked],
    )
  )[0].id as string;
};

describe("period of a day", () => {
  test.each([
    ["2026-10-11", "2026-10-01"],
    ["2026-11-10", "2026-10-01"],
    ["2026-11-11", "2026-11-01"],
    ["2027-01-05", "2026-12-01"],
  ])("%s belongs to %s", async (day, month) => {
    expect((await q("select public.pay_period_of($1::date)::text as m", [day]))[0].m).toBe(month);
  });
  test("October's period ends on 10 November", async () => {
    expect((await q("select public.pay_period_last_day('2026-10-01')::text as d"))[0].d).toBe("2026-11-10");
  });
});

describe("the database decides the month", () => {
  test("new work goes to the open month, whatever month was sent", async () => {
    expect(await monthOf(await logWork())).toBe(current);
  });

  test("approving puts work in the month of the approval date (even if an older month was never closed)", async () => {
    const id = await logWork();
    await asOwner(db);
    await q("update public.submissions set work_month = '2026-07-01' where id = $1", [id]); // left in an old open month
    await actAs(db, main);
    await q("update public.submissions set status = 'approved' where id = $1", [id]);
    expect(await monthOf(id)).toBe(current);
    // Later edits by an admin don't move approved work.
    await actAs(db, main);
    await q("update public.submissions set quantity = 2, work_month = '2026-07-01' where id = $1", [id]);
    expect(await monthOf(id)).toBe(current);
  });
});

describe("last month stays open until it is closed", () => {
  // 2024 months, so it never touches a month another test closes.
  test("work goes to last month until it is closed, never before pay periods started", async () => {
    await asOwner(db);
    const [{ from }] = await q("select pay_periods_from::text as from from public.app_settings limit 1");
    const open = async (day: string) => (await q("select public.open_pay_period($1::date)::text as m", [day]))[0].m;
    try {
      await q("update public.app_settings set pay_periods_from = '2024-01-01' where true");
      expect(await open("2024-03-15")).toBe("2024-02-01"); // February not closed yet
      expect(await open("2024-01-15")).toBe("2024-01-01"); // December 2023 is before pay periods
      await q("insert into public.pay_months (month) values ('2024-02-01')");
      expect(await open("2024-03-15")).toBe("2024-03-01"); // February closed
    } finally {
      await q("delete from public.pay_months where month = '2024-02-01'");
      await q("update public.app_settings set pay_periods_from = $1 where true", [from]);
    }
  });
});

describe("closing a month", () => {
  test("can't close a month whose period hasn't ended", async () => {
    await actAs(db, main);
    await expect(db.query("select public.close_pay_month($1::date)", [current])).rejects.toThrow(/runs until/);
  });

  test("closing moves work that isn't approved to the next open month", async () => {
    const pending = await logWork();
    const approved = await logWork();
    await actAs(db, main);
    await q("update public.submissions set status = 'approved' where id = $1", [approved]);
    await asOwner(db);
    await q("update public.submissions set work_month = '2026-05-01' where id = any($1)", [[pending, approved]]);
    await q("insert into public.pay_months (month) values ('2026-06-01')"); // June already closed

    await actAs(db, main);
    await q("select public.close_pay_month('2026-05-01')");
    expect(await monthOf(approved)).toBe("2026-05-01");
    expect(await monthOf(pending)).toBe("2026-07-01"); // skips closed June
    await asOwner(db);
    const payout = await q("select approved_items from public.payouts where month = '2026-05-01' and user_id = $1", [
      (member as { id: string }).id,
    ]);
    expect(payout[0].approved_items).toBe(1);
  });
});

describe("fixed salaries follow the pay period", () => {
  test("a salary from March is paid for March; one from April is not", async () => {
    const inside = await createPerson(db);
    const after = await createPerson(db);
    await asOwner(db);
    const section = (await q("insert into public.sections (name) values ('Salary test') returning id"))[0].id;
    const salaried = (
      await q("insert into public.roles (section_id, name, is_salaried) values ($1, 'LMS Admin', true) returning id", [section])
    )[0].id;
    for (const [user, from] of [
      [inside, "2026-03-01"],
      [after, "2026-04-01"],
    ]) {
      await q("insert into public.member_roles (user_id, role_id) values ($1, $2)", [user, salaried]);
      await q("insert into public.member_salaries (user_id, role_id, monthly_amount, from_month) values ($1, $2, 25000, $3)", [
        user,
        salaried,
        from,
      ]);
    }

    await actAs(db, main);
    await q("select public.close_pay_month('2026-03-01')");
    await asOwner(db);
    const paid = await q("select user_id, salary_amount::text as s from public.payouts where month = '2026-03-01'");
    expect(paid.find((p) => p.user_id === inside)?.s).toBe("25000.00");
    expect(paid.find((p) => p.user_id === after)).toBeUndefined();
  });
});
