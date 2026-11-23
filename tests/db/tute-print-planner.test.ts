// Tute inventory Phase 2: self-picking forecast, start rule, paid list vs
// forecast, safety stock + rounding, learned print time, odd-number flags,
// and the forecast report card.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";

let db: pg.Client;
let editor: Actor;
let batch = "";
const stamp = Date.now();
const MONTH = (offset: number) =>
  `(date_trunc('month', now() at time zone 'Asia/Colombo') + interval '${offset} months')::date`;

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

async function newClass(name: string, counts: Record<number, number>): Promise<string> {
  await actAs(db, editor);
  const id = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `${name} ${stamp}`]))[0].id;
  await asOwner(db);
  for (const [offset, n] of Object.entries(counts)) {
    await q(`insert into public.fee_month_imports (class_id, month, unique_student_count) values ($1, ${MONTH(Number(offset))}, $2)`, [id, n]);
  }
  return id;
}

async function forecast(classId: string, offset: number) {
  await asOwner(db);
  return (await q(`select * from public.tute_class_forecast($1, ${MONTH(offset)})`, [classId]))[0];
}

async function newTute(name: string, classId: string, offsets: number[]): Promise<string> {
  await actAs(db, editor);
  return (
    await q(
      `select public.class_tute_create_and_assign($1, $2, $3, '', array[${offsets.map(MONTH).join(", ")}]) as id`,
      [batch, classId, `${name} ${stamp}`],
    )
  )[0].id;
}

async function summary(tuteId: string) {
  await actAs(db, editor);
  return (await q("select * from public.tute_stock_summary($1, null) where tute_id = $2", [batch, tuteId]))[0];
}

beforeAll(async () => {
  db = await session();
  editor = {
    kind: "user",
    id: await createPerson(db, { pageAccess: { tutes: "edit", fee_reminders: "edit" } }),
    aal: "aal2",
  };
  batch = await createBatch(db);
});

afterAll(() => db.end());

describe("forecast", () => {
  test("a steady class is forecast at its steady size, with no spread", async () => {
    const id = await newClass("Steady", { [-5]: 100, [-4]: 100, [-3]: 100, [-2]: 100, [-1]: 100 });
    expect(await forecast(id, 0)).toMatchObject({ expected: 100, low: 100, high: 100, months_used: 5 });
  });

  test("a growing class picks the trend method and keeps growing", async () => {
    const id = await newClass("Growing", { [-5]: 50, [-4]: 60, [-3]: 70, [-2]: 80, [-1]: 90 });
    expect(await forecast(id, 0)).toMatchObject({ expected: 100, method: "trend" });
    expect((await forecast(id, 1)).expected).toBe(110);
  });

  test("with little history it uses last month × pay-again rate + new students", async () => {
    const id = await newClass("New", { [-2]: 4, [-1]: 5 });
    await asOwner(db);
    const students: [number, string][] = [
      [-2, "a"], [-2, "b"], [-2, "c"], [-2, "d"],
      [-1, "a"], [-1, "b"], [-1, "c"], [-1, "e"], [-1, "f"],
    ];
    for (const [offset, key] of students) {
      await q(`insert into public.fee_month_students (class_id, month, student_key, full_name, institute)
               values ($1, ${MONTH(offset)}, $2, $2, $3)`, [id, `k-${key}`, key === "a" || key === "b" ? "Online" : "Hall"]);
    }
    // 3 of 4 paid again (75%), 2 new: 5 × 0.75 + 2 = 5.75
    expect(await forecast(id, 0)).toMatchObject({ expected: 6, method: "start_rule" });
    expect(await forecast(id, -2)).toMatchObject({ expected: 0, method: "none" });
  });

  test("this month uses the paid list or the forecast, whichever is higher; past months use the list", async () => {
    const id = await newClass("Mixed", { [-5]: 100, [-4]: 100, [-3]: 100, [-2]: 100, [-1]: 100, [0]: 80 });
    await asOwner(db);
    expect((await q(`select public.tute_expected_students($1, ${MONTH(0)}) as n`, [id]))[0].n).toBe(100);
    await q(`update public.fee_month_imports set unique_student_count = 130 where class_id = $1 and month = ${MONTH(0)}`, [id]);
    expect((await q(`select public.tute_expected_students($1, ${MONTH(0)}) as n`, [id]))[0].n).toBe(130);
    await q(`update public.fee_month_imports set unique_student_count = 70 where class_id = $1 and month = ${MONTH(-1)}`, [id]);
    expect((await q(`select public.tute_expected_students($1, ${MONTH(-1)}) as n`, [id]))[0].n).toBe(70);
  });
});

describe("print plan", () => {
  let classId = "";
  let tuteId = "";

  test("needs the forecast plus safety stock, rounded up to the print batch", async () => {
    classId = await newClass("Planned", { [-5]: 100, [-4]: 100, [-3]: 100, [-2]: 100, [-1]: 100 });
    tuteId = await newTute("Unit 09", classId, [1]);
    await actAs(db, editor);
    await q("select public.tute_settings_save($1, 40, null, 25)", [tuteId]);
    const row = await summary(tuteId);
    // next month ~100, safety max(1.65 × 0, 5% of 100, 5) = 5 → 105 → 125
    expect(row).toMatchObject({ need_next: 100, safety: 5, loss_extra: 0, print_now: 125, status: "low" });
    expect(row.classes_next[0]).toMatchObject({ expected: 100, uploaded: false, method: "last_month" });
  });

  test("print-by uses the printer's real time from past jobs", async () => {
    await actAs(db, editor);
    const printer = (await q("select public.tute_printer_save(null, $1, '', '', 7, true) as id", [`Press ${stamp}`]))[0].id;
    const job = (await q("select public.tute_print_job_create($1, 125, $2) as id", [tuteId, printer]))[0].id;
    await asOwner(db);
    await q("update public.tute_print_jobs set created_at = now() - interval '12 days' where id = $1", [job]);
    await actAs(db, editor);
    await q("select public.tute_print_job_receive($1, 125)", [job]);
    const row = await summary(tuteId);
    expect(row).toMatchObject({ lead_days: 12, on_hand: 125, print_now: 0, print_by: null, status: "ok" });
  });

  test("the report card compares each month's forecast with what was paid", async () => {
    await actAs(db, editor);
    const rows = await q("select * from public.tute_forecast_report($1) where class_id = $2", [batch, classId]);
    expect(rows.map((r) => [r.forecast, r.actual])).toEqual([
      [100, 100],
      [100, 100],
      [100, 100],
    ]);
  });
});

describe("odd numbers", () => {
  test("a count far off the usual fixes is flagged and sent as an alert", async () => {
    const classId = await newClass("Counted", { [-1]: 50 });
    const tuteId = await newTute("Unit 10", classId, [0]);
    await actAs(db, editor);
    for (const n of [100, 98, 97, 60]) await q("select public.tute_stock_count($1, $2)", [tuteId, n]);
    await asOwner(db);
    const flags = (await q("select qty, flag from public.tute_stock_moves where tute_id = $1 order by created_at", [tuteId])).map(
      (r) => [r.qty, r.flag !== ""],
    );
    expect(flags).toEqual([
      [100, false],
      [-2, false],
      [-1, false],
      [-37, true],
    ]);
    const sent = await q("select count(*)::int as n from public.notifications where kind = 'tute.odd' and title like $1", [
      `%Unit 10 ${stamp}`,
    ]);
    expect(sent[0].n).toBeGreaterThan(0);
  });

  test("giving a class more copies than it has students is flagged", async () => {
    const classId = await newClass("Handout", { [0]: 100 });
    const tuteId = await newTute("Unit 11", classId, [0]);
    await actAs(db, editor);
    await q("select public.tute_stock_count($1, 300)", [tuteId]);
    await q("select public.tute_stock_issue($1, 100, 'class_issue', $2)", [tuteId, classId]);
    await q("select public.tute_stock_issue($1, 30, 'class_issue', $2)", [tuteId, classId]);
    await asOwner(db);
    const flags = (
      await q("select flag from public.tute_stock_moves where tute_id = $1 and kind = 'class_issue' order by created_at", [tuteId])
    ).map((r) => r.flag !== "");
    expect(flags).toEqual([false, true]);
  });
});
