// Money page (main admins only): class fees "from a month", income per
// class-month (amounts, or paid × fee), and printing / postage costs.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, createTute, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let main: Actor;
let admin: Actor;
let classEditor: Actor;
let batch = "";
let cls = "";
const stamp = Date.now();
const THIS_MONTH = "date_trunc('month', now() at time zone 'Asia/Colombo')::date";

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

/** One class-month row from money_income, as the main admin. */
async function incomeRow(classId: string, from: string, to: string, month: string) {
  await actAs(db, main);
  const rows = await q(
    "select month::text as month, fee, paid, free, amount_total, income, income_source from public.money_income($1, $2) where class_id = $3",
    [from, to, classId],
  );
  return rows.find((r) => r.month === month);
}

async function addList(classId: string, month: string, rows: { key: string; label?: string; amount?: number }[]) {
  await asOwner(db);
  for (const r of rows) {
    await q(
      `insert into public.fee_month_students (class_id, month, student_key, full_name, export_label, amount)
       values ($1, ${month}, $2, $2, $3, $4)`,
      [classId, r.key, r.label ?? "", r.amount ?? null],
    );
  }
  await q(
    `insert into public.fee_month_imports (class_id, month, unique_student_count, uploaded_at)
     values ($1, ${month}, $2, now() - interval '1 hour')`,
    [classId, rows.length],
  );
}

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  classEditor = { kind: "user", id: await createPerson(db, { pageAccess: { class_ops: "edit" } }), aal: "aal2" };
  batch = await createBatch(db);
  await actAs(db, main);
  cls = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `Money ${stamp}`]))[0].id;
});

afterAll(() => db.end());

describe("class fees and money", () => {
  test("only main admins", async () => {
    for (const who of [admin, classEditor]) {
      await actAs(db, who);
      expect(await outcome(db, "select public.class_fee_set($1, '2026-09-01', 1000)", [cls])).toBe("42501");
      expect(await outcome(db, "select * from public.class_fee_list()")).toBe("42501");
      expect(await outcome(db, "select * from public.money_income('2026-09-01', '2026-10-01')")).toBe("42501");
      expect(await outcome(db, "select * from public.money_costs('2026-09-01', '2026-10-01')")).toBe("42501");
    }
    await actAs(db, main);
    expect(await outcome(db, "select public.class_fee_for($1, '2026-09-01')", [cls])).toBe("42501");
  });

  test("fee from_month applies forward", async () => {
    await actAs(db, main);
    expect(await outcome(db, "select public.class_fee_set($1, '2026-09-01', -5)", [cls])).toBe("P0001");
    await q("select public.class_fee_set($1, '2026-09-01', 1000)", [cls]);
    await q("select public.class_fee_set($1, '2026-11-01', 1500)", [cls]);
    await q("select public.class_fee_set($1, '2026-11-15', 1500)", [cls]);
    for (const [month, fee] of [
      ["2026-09-01", "1000.00"],
      ["2026-10-01", "1000.00"],
      ["2026-11-01", "1500.00"],
      ["2026-12-01", "1500.00"],
    ]) {
      expect((await incomeRow(cls, "2026-09-01", "2026-12-01", month))?.fee).toBe(fee);
    }
    await asOwner(db);
    expect((await q("select count(*)::int as n from public.class_fees where class_id = $1 and from_month = '2026-11-01'", [cls]))[0].n).toBe(1);
    await actAs(db, main);
    const listed = (await q("select fee from public.class_fee_list() where class_id = $1", [cls]))[0];
    expect(listed.fee).toBe("1500.00");
  });

  test("income from fee", async () => {
    await addList(cls, "'2026-11-01'::date", [
      { key: `a-${stamp}` },
      { key: `b-${stamp}` },
      { key: `c-${stamp}`, label: "Free enrollment" },
    ]);
    expect(await incomeRow(cls, "2026-11-01", "2026-11-01", "2026-11-01")).toMatchObject({
      paid: 3,
      free: 1,
      income: "3000.00",
      income_source: "fee",
    });
  });

  test("income from amounts", async () => {
    await addList(cls, "'2026-10-01'::date", [
      { key: `d-${stamp}`, amount: 1200 },
      { key: `e-${stamp}`, amount: 800 },
    ]);
    expect(await incomeRow(cls, "2026-10-01", "2026-10-01", "2026-10-01")).toMatchObject({
      income: "2000.00",
      income_source: "amounts",
    });
  });

  test("typed count without list", async () => {
    await actAs(db, main);
    const typed = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `Typed money ${stamp}`]))[0].id;
    await q(`select public.class_fee_set($1, ${THIS_MONTH}, 500)`, [typed]);
    await actAs(db, classEditor);
    await q("select public.class_paid_count_save($1, 7)", [typed]);
    await actAs(db, main);
    const [row] = await q(
      `select free, income, income_source from public.money_income(${THIS_MONTH}, ${THIS_MONTH}) where class_id = $1`,
      [typed],
    );
    expect(row).toMatchObject({ free: 0, income: "3500.00", income_source: "fee" });
  });

  test("never negative", async () => {
    await actAs(db, main);
    const neg = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `Negative ${stamp}`]))[0].id;
    await q(`select public.class_fee_set($1, ${THIS_MONTH}, 800)`, [neg]);
    await addList(neg, THIS_MONTH, [
      { key: `f-${stamp}`, label: "Free enrollment" },
      { key: `g-${stamp}`, label: "Free enrollment" },
    ]);
    await actAs(db, classEditor);
    await q("select public.class_paid_count_save($1, 1)", [neg]);
    await actAs(db, main);
    const [row] = await q(`select paid, income from public.money_income(${THIS_MONTH}, ${THIS_MONTH}) where class_id = $1`, [neg]);
    expect(row).toMatchObject({ paid: 1, income: "0.00" });
  });

  test("no fee gives no_fee", async () => {
    await actAs(db, main);
    const nofee = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `No fee ${stamp}`]))[0].id;
    await addList(nofee, "'2026-11-01'::date", [{ key: `h-${stamp}` }]);
    expect(await incomeRow(nofee, "2026-11-01", "2026-11-01", "2026-11-01")).toMatchObject({
      paid: 1,
      income: null,
      income_source: "no_fee",
    });
  });

  test("costs by month", async () => {
    await actAs(db, main);
    const tute = await createTute(db, cls, `Money tute ${stamp}`, []);
    await asOwner(db);
    for (const [status, cost, received] of [
      ["received", 5000, "2031-04-10 10:00+05:30"],
      ["cancelled", 999, "2031-04-11 10:00+05:30"],
      ["received", null, "2031-04-12 10:00+05:30"],
    ]) {
      await q("insert into public.tute_print_jobs (tute_id, qty, status, cost, received_at) values ($1, 10, $2, $3, $4)", [
        tute,
        status,
        cost,
        received,
      ]);
    }
    for (const [status, total] of [
      ["handed_over", 2400],
      ["cancelled", 9999],
    ]) {
      await q("insert into public.post_rounds (batch_id, month, kind, status, receipt_total) values ($1, '2031-04-01', 'main', $2, $3)", [
        batch,
        status,
        total,
      ]);
    }
    await actAs(db, main);
    const rows = await q("select month::text as month, printing, postage from public.money_costs('2031-03-01', '2031-04-01') order by month");
    expect(rows).toEqual([
      { month: "2031-03-01", printing: "0", postage: "0" },
      { month: "2031-04-01", printing: "5000.00", postage: "2400.00" },
    ]);
  });

  test("range limit", async () => {
    await actAs(db, main);
    expect(await outcome(db, "select * from public.money_income('2024-01-01', '2026-12-01')")).toBe("P0001");
    expect(await outcome(db, "select * from public.money_costs('2026-12-01', '2026-01-01')")).toBe("P0001");
  });
});
