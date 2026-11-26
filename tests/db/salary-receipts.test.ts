// Salary receipts: each payslip has a random code, and anyone with the code can
// see the WhatsApp message's fields while (and only while) it is marked paid.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let main: Actor;
let payoutId = "";
let token = "";
let zeroToken = "";

const MONTH = "2019-06-01";
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  const memberId = await createPerson(db, { name: "Kasun Perera" });
  const other = await createPerson(db);
  await asOwner(db);
  await q("insert into public.pay_months (month) values ($1)", [MONTH]);
  const [row] = await q(
    `insert into public.payouts (month, payslip_no, user_id, member_name, member_email, member_nic, bank_name, account_last4,
       salary_amount, work_amount, approved_items)
     values ($1, 'PS-TEST-RCPT-1', $2, '  Kasun Perera ', 'k@example.test', '200012345678', 'BOC', '4581', 15000, 9500, 7)
     returning id, receipt_token::text as t`,
    [MONTH, memberId],
  );
  payoutId = row.id;
  token = row.t;
  const [zero] = await q(
    `insert into public.payouts (month, payslip_no, user_id, member_name, member_email, status, paid_on)
     values ($1, 'PS-TEST-RCPT-2', $2, 'Zero Person', 'z@example.test', 'paid', current_date)
     returning receipt_token::text as t`,
    [MONTH, other],
  );
  zeroToken = zero.t;
});
afterAll(() => db.end());

const receipt = async (t: string) => {
  await actAs(db, { kind: "anon" });
  return q("select * from public.payout_receipt($1::uuid)", [t]);
};
const setPaid = async (paid: boolean, on: string | null, ref: string | null) => {
  await actAs(db, main);
  await q("select public.set_payouts_paid(array[$1::uuid], $2, $3::date, $4)", [payoutId, paid, on, ref]);
};

describe("salary receipts", () => {
  test("every payout has a distinct token", async () => {
    await asOwner(db);
    const [r] = await q("select count(*)::int as n, count(distinct receipt_token)::int as d from public.payouts");
    expect(r.d).toBe(r.n);
  });

  test("nothing while unpaid", async () => {
    expect(await receipt(token)).toHaveLength(0);
  });

  test("paid receipt shows only the message fields", async () => {
    await setPaid(true, "2020-07-05", "BOC 4581");
    const rows = await receipt(token);
    expect(rows).toHaveLength(1);
    expect(rows[0].payment_reference).toBe("BOC 4581");
    expect(rows[0].first_name).toBe("Kasun");
    expect(Number(rows[0].total_amount)).toBe(24500);
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "approved_items",
        "first_name",
        "month",
        "paid_on",
        "payment_reference",
        "payslip_no",
        "salary_amount",
        "total_amount",
        "work_amount",
      ].sort(),
    );
  });

  test("stops after mark not paid", async () => {
    await setPaid(false, null, null);
    expect(await receipt(token)).toHaveLength(0);
  });

  test("shows the latest payment", async () => {
    await setPaid(true, "2020-07-06", "Sampath 77");
    const [r] = await receipt(token);
    expect(r.payment_reference).toBe("Sampath 77");
    expect(r.paid_on.toLocaleDateString("en-CA")).toBe("2020-07-06");
  });

  test("zero total gives nothing", async () => {
    expect(await receipt(zeroToken)).toHaveLength(0);
  });

  test("unknown token gives nothing", async () => {
    expect(await receipt("00000000-0000-4000-8000-000000000000")).toHaveLength(0);
  });

  test("anon still cannot read payouts", async () => {
    await actAs(db, { kind: "anon" });
    expect(await outcome(db, "select count(*) from public.payouts")).not.toBe("ok");
  });
});
