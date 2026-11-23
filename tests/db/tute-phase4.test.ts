// Phase 4: mid-month forecast from the upload log, return-risk flag (after 30
// known outcomes), and the Monday summary.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, session, type Actor } from "./helpers";

let db: pg.Client;
let stocker: Actor;
let poster: Actor;
let batch = "";
const stamp = Date.now();
const MONTH = (offset: number) =>
  `(date_trunc('month', now() at time zone 'Asia/Colombo') + interval '${offset} months')::date`;
/** A moment on day `day` of that month, Sri Lanka time. */
const ON_DAY = (offset: number, day: number) => `((${MONTH(offset)} + ${day - 1})::timestamp at time zone 'Asia/Colombo' + interval '1 hour')`;

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const id = (a: Actor) => (a.kind === "user" ? a.id : "");

beforeAll(async () => {
  db = await session();
  stocker = { kind: "user", id: await createPerson(db, { pageAccess: { tutes: "edit", fee_reminders: "edit" } }), aal: "aal2" };
  poster = { kind: "user", id: await createPerson(db, { pageAccess: { post: "edit" } }), aal: "aal2" };
  batch = await createBatch(db);
});

afterAll(() => db.end());

describe("mid-month forecast", () => {
  test("an early upload is scaled up by how far payments usually are by that day", async () => {
    await actAs(db, stocker);
    const classId = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `Paced ${stamp}`]))[0].id;
    await asOwner(db);
    // Four past months: 50 paid by day 1, 100 by day 28.
    for (const offset of [-4, -3, -2, -1]) {
      await q(
        `insert into public.fee_month_imports (class_id, month, unique_student_count, uploaded_at)
         values ($1, ${MONTH(offset)}, 50, ${ON_DAY(offset, 1)})`,
        [classId],
      );
      await q(
        `update public.fee_month_imports set unique_student_count = 100, uploaded_at = ${ON_DAY(offset, 28)}
         where class_id = $1 and month = ${MONTH(offset)}`,
        [classId],
      );
    }
    // This month: 60 paid by day 1 → about 120 by month end.
    await q(
      `insert into public.fee_month_imports (class_id, month, unique_student_count, uploaded_at)
       values ($1, ${MONTH(0)}, 60, ${ON_DAY(0, 1)})`,
      [classId],
    );
    expect((await q(`select public.tute_paced_expected($1, ${MONTH(0)}) as n`, [classId]))[0].n).toBe(120);
    expect((await q(`select public.tute_expected_students($1, ${MONTH(0)}) as n`, [classId]))[0].n).toBe(120);
    // Past months never use it.
    expect((await q(`select public.tute_paced_expected($1, ${MONTH(-1)}) as n`, [classId]))[0].n).toBeNull();

    await actAs(db, stocker);
    expect((await q("select * from public.tute_pace_status($1)", [batch]))[0].samples).toBe(4);
  });
});

describe("return risk", () => {
  let roundId = "";
  let risky = "";
  let returnedBefore = "";
  let fine = "";

  test("stays quiet while learning, then flags parcels likely to come back", async () => {
    await asOwner(db);
    const old = (
      await q("insert into public.post_rounds (batch_id, month, kind, status) values ($1, date '2026-01-01', 'main', 'handed_over') returning id", [batch])
    )[0].id;
    let n = 0;
    const parcel = (round: string, district: string, status: string, address: string, whatsapp: string | null = "94771234567") =>
      q(
        `insert into public.post_parcels (round_id, number, student_key, full_name, whatsapp, address, district, status, status_at)
         values ($1, $2, $3, 'Student', $4, $5, $6, $7, now()) returning id`,
        [round, ++n, `risk-${stamp}-${n}`, whatsapp, address, district, status],
      ).then((r) => r[0].id as string);

    roundId = (await q("insert into public.post_rounds (batch_id, month, kind) values ($1, date '2026-02-01', 'main') returning id", [batch]))[0].id;
    fine = await parcel(roundId, `Colombo-${stamp}`, "packed", "12 Temple Road, Maharagama");

    await actAs(db, poster);
    const learning = (await q("select * from public.post_risk_learning()"))[0];
    if (learning.resolved < 30) {
      expect(await q("select * from public.post_round_risks($1)", [roundId])).toEqual([]);
    }

    await asOwner(db);
    for (let i = 0; i < 30; i++) await parcel(old, `Colombo-${stamp}`, "delivered", `${i} Main Street, Colombo`);
    for (let i = 0; i < 4; i++) await parcel(old, `Moneragala-${stamp}`, "returned", `${i} Far Road, Moneragala`);
    await parcel(old, `Moneragala-${stamp}`, "delivered", "9 Far Road, Moneragala");
    await parcel(old, `Colombo-${stamp}`, "returned", "77 Lake Drive, Nugegoda");

    risky = await parcel(roundId, `Moneragala-${stamp}`, "planned", "5 Hill Road, Moneragala");
    returnedBefore = await parcel(roundId, `Colombo-${stamp}`, "planned", "77, Lake Drive, NUGEGODA");

    await actAs(db, poster);
    const flagged = await q("select parcel_id, reason from public.post_round_risks($1)", [roundId]);
    const byId = new Map(flagged.map((r) => [r.parcel_id, r.reason]));
    expect(byId.get(risky)).toMatch(/Moneragala-\d+: 4 of 5 came back/);
    expect(byId.get(returnedBefore)).toMatch(/came back before/);
    expect(byId.has(fine)).toBe(false);
  });
});

describe("weekly summary", () => {
  test("each person gets one Monday note with the parts they can open", async () => {
    await actAs(db, stocker);
    const classId = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `Weekly ${stamp}`]))[0].id;
    const tute = (
      await q(`select public.class_tute_create_and_assign($1, $2, $3, '', array[${MONTH(0)}]) as id`, [batch, classId, `Unit 20 ${stamp}`])
    )[0].id;
    await asOwner(db);
    await q("insert into public.tute_alert_state (tute_id, level) values ($1, 'out') on conflict (tute_id) do update set level = 'out'", [tute]);

    expect((await q("select public.send_tute_weekly_summary() as n"))[0].n).toBeGreaterThan(0);
    await q("select public.send_tute_weekly_summary()");
    const notes = await q("select user_id, body from public.notifications where kind = 'tute.weekly' and user_id = any($1)", [
      [id(stocker), id(poster)],
    ]);
    const forStocker = notes.filter((n) => n.user_id === id(stocker));
    const forPoster = notes.filter((n) => n.user_id === id(poster));
    expect(forStocker).toHaveLength(1);
    expect(forStocker[0].body).toMatch(/^Stock: .*out of stock/);
    expect(forStocker[0].body).not.toMatch(/Speed Post/);
    expect(forPoster).toHaveLength(1);
    expect(forPoster[0].body).toMatch(/^Speed Post: .*to pack/);
  });
});
