// Review limit: how long work may wait, the waiting summary, and the daily reminder.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let main: Actor;
let adminA: Actor;
let plain: Actor;
let memberId = "";
let role = "";
let memberLate = "";
const base: Record<string, { waiting: number; over_limit: number }> = {};

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const id = (a: Actor) => (a as { id: string }).id;

/** A pending submission made `hoursAgo` hours ago (inserted as owner). */
async function work(userId: string, hoursAgo: number, resubmittedHoursAgo: number | null = null) {
  await asOwner(db);
  return (
    await q(
      `insert into public.submissions (user_id, role_id, work_month, title, quantity, date_done, created_at, resubmitted_at)
       values ($1, $2, date_trunc('month', current_date)::date, 'Waiting work', 1, current_date,
               now() - make_interval(hours => $3), case when $4::int is null then null else now() - make_interval(hours => $4::int) end)
       returning id`,
      [userId, role, hoursAgo, resubmittedHoursAgo],
    )
  )[0].id as string;
}

async function summary(a: Actor) {
  await actAs(db, a);
  const r = (await q("select waiting, over_limit from public.review_waiting_summary()"))[0];
  return { waiting: r.waiting - base[id(a)].waiting, over_limit: r.over_limit - base[id(a)].over_limit };
}

const notices = async (user: string) =>
  (await q("select title from public.notifications where user_id = $1 and kind = 'review.late'", [user])).map(
    (r) => r.title as string,
  );

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  adminA = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  plain = { kind: "user", id: await createPerson(db), aal: "aal2" };
  memberId = await createPerson(db);
  await asOwner(db);
  const section = (await q("insert into public.sections (name) values ('Review limit test') returning id"))[0].id;
  role = (await q("insert into public.roles (section_id, name) values ($1, 'Waiter') returning id", [section]))[0].id;
  // Other test files leave pending work behind: count from here.
  for (const a of [main, adminA]) {
    await actAs(db, a);
    const r = (await q("select waiting, over_limit from public.review_waiting_summary()"))[0];
    base[id(a)] = { waiting: r.waiting, over_limit: r.over_limit };
  }
  memberLate = await work(memberId, 30);
  await work(memberId, 2);
  await work(id(adminA), 40);
});

afterAll(() => db.end());

describe("review limit", () => {
  test("access", async () => {
    await actAs(db, plain);
    expect(await outcome(db, "select public.review_limit_set(12)")).toBe("42501");
    expect(await outcome(db, "select * from public.review_waiting_summary()")).toBe("42501");
    expect((await q("select public.review_limit_hours() as h"))[0].h).toBe(24);
  });

  test("limit validated", async () => {
    await actAs(db, adminA);
    expect(await outcome(db, "select public.review_limit_set(0)")).toBe("P0001");
    expect(await outcome(db, "select public.review_limit_set(169)")).toBe("P0001");
    await q("select public.review_limit_set(12)");
    expect((await q("select public.review_limit_hours() as h"))[0].h).toBe(12);
    await q("select public.review_limit_set(24)");
  });

  test("summary", async () => {
    expect(await summary(adminA)).toEqual({ waiting: 2, over_limit: 1 });
    expect(await summary(main)).toEqual({ waiting: 3, over_limit: 2 });
  });

  test("once a day", async () => {
    await asOwner(db);
    await q("select public.send_review_late_notices()");
    await q("select public.send_review_late_notices()");
    const a = await notices(id(adminA));
    expect(a).toHaveLength(1);
    expect(base[id(adminA)].over_limit).toBe(0); // other files' work is fresh
    expect(a[0]).toMatch(/^1 piece of work waiting over 24 h/);
    expect(await notices(id(main))).toHaveLength(1);
    expect(await notices(id(plain))).toHaveLength(0);
  });

  test("own work not counted", async () => {
    await asOwner(db);
    await q("update public.submissions set status = 'approved' where id = $1", [memberLate]);
    await q("delete from public.notifications where user_id = $1 and kind = 'review.late'", [id(adminA)]);
    await q("select public.send_review_late_notices()");
    expect(await notices(id(adminA))).toHaveLength(0);
    expect(await summary(adminA)).toEqual({ waiting: 1, over_limit: 0 });
  });

  test("waiting starts again", async () => {
    await work(memberId, 120, 1);
    expect(await summary(adminA)).toEqual({ waiting: 2, over_limit: 0 });
  });
});
