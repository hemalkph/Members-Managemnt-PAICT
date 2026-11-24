// Speed Post (Phase 3): private addresses, rounds that reserve stock, one
// parcel per home, never twice, handover posts stock out once, returns.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, createTute, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let poster: Actor;
let uploader: Actor;
let stocker: Actor;
let nobody: Actor;
let batch = "";
let classId = "";
let tuteId = "";
let mainRound = "";
const stamp = Date.now();
const MONTH = "date_trunc('month', now() at time zone 'Asia/Colombo')::date";

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const key = (k: string) => `${k}-${stamp}`;
const onHand = async () => {
  await asOwner(db);
  return (await q("select coalesce(sum(qty), 0)::int as n from public.tute_stock_moves where tute_id = $1", [tuteId]))[0].n;
};
const addresses = (rows: { k: string; address: string }[]) =>
  JSON.stringify(rows.map((r) => ({ student_key: key(r.k), full_name: r.k, whatsapp: "94771234567", address: r.address })));

beforeAll(async () => {
  db = await session();
  poster = { kind: "user", id: await createPerson(db, { pageAccess: { post: "edit" } }), aal: "aal2" };
  uploader = { kind: "user", id: await createPerson(db, { pageAccess: { fee_reminders: "edit" } }), aal: "aal2" };
  stocker = { kind: "user", id: await createPerson(db, { pageAccess: { tutes: "edit", fee_reminders: "edit" } }), aal: "aal2" };
  nobody = { kind: "user", id: await createPerson(db), aal: "aal2" };
  batch = await createBatch(db);

  await actAs(db, stocker);
  classId = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `Revision ${stamp}`]))[0].id;
  tuteId = await createTute(db, classId, `Unit 12 ${stamp}`, [MONTH]);

  await asOwner(db);
  await q(`insert into public.fee_month_imports (class_id, month, unique_student_count) values ($1, ${MONTH}, 4)`, [classId]);
  for (const [k, institute] of [["amal", "Online"], ["bimal", "Online"], ["chamal", "Online"], ["dilan", "Hall"]]) {
    await q(
      `insert into public.fee_month_students (class_id, month, student_key, full_name, institute, whatsapp_norm)
       values ($1, ${MONTH}, $2, $3, $4, '94771234567')`,
      [classId, key(k), k, institute],
    );
  }
});

afterAll(() => db.end());

describe("addresses", () => {
  test("the uploader can save addresses but not read them; only the Speed Post page reads them", async () => {
    await actAs(db, uploader);
    const saved = await q("select public.post_addresses_save($1::jsonb) as n", [
      addresses([
        { k: "amal", address: "12 Lake Road, Kandy" },
        { k: "bimal", address: "12, lake road KANDY" },
        { k: "chamal", address: "Anamaduwa" },
      ]),
    ]);
    expect(saved[0].n).toBe(3);
    expect(await q("select * from public.student_addresses where student_key like $1", [`%-${stamp}`])).toEqual([]);

    await actAs(db, nobody);
    expect(await outcome(db, "select * from public.post_month_students($1, null)", [batch])).not.toBe("ok");
    expect(await outcome(db, "select public.post_addresses_save('[]'::jsonb)")).toBe("42501");
  });

  test("Online students who paid are listed with problems; confirming skips unclear ones", async () => {
    await actAs(db, poster);
    const rows = await q(`select full_name, problem, checked from public.post_month_students($1, ${MONTH}) order by full_name`, [batch]);
    expect(rows).toEqual([
      { full_name: "amal", problem: "", checked: false },
      { full_name: "bimal", problem: "", checked: false },
      { full_name: "chamal", problem: "Too short", checked: false },
    ]);
    const n = await q("select public.post_addresses_confirm($1) as n", [[key("amal"), key("bimal"), key("chamal")]]);
    expect(n[0].n).toBe(2);
  });

  test("a new LMS address replaces a staff correction; the same one keeps it", async () => {
    await actAs(db, poster);
    await q("select public.post_address_save($1, $2, true)", [key("chamal"), "No 5, Main Street, Anamaduwa"]);
    await actAs(db, uploader);
    await q("select public.post_addresses_save($1::jsonb)", [addresses([{ k: "chamal", address: "Anamaduwa" }])]);
    await actAs(db, poster);
    let [a] = await q("select address, checked from public.student_addresses where student_key = $1", [key("chamal")]);
    expect(a).toEqual({ address: "No 5, Main Street, Anamaduwa", checked: true });

    await actAs(db, uploader);
    await q("select public.post_addresses_save($1::jsonb)", [addresses([{ k: "chamal", address: "New House, Puttalam" }])]);
    await actAs(db, poster);
    [a] = await q("select address, checked from public.student_addresses where student_key = $1", [key("chamal")]);
    expect(a).toEqual({ address: "New House, Puttalam", checked: false });
  });
});

describe("rounds", () => {
  test("a round can't be built without enough stock", async () => {
    await actAs(db, poster);
    const err = await db.query(`select public.post_round_build($1, ${MONTH}, 'main')`, [batch]).catch((e) => e);
    expect(err.code).toBe("P0001");
    expect(err.message).toMatch(/Not enough stock/);
  });

  test("brothers and sisters at one address get one parcel; copies are reserved, not yet out", async () => {
    await actAs(db, stocker);
    await q("select public.tute_stock_count($1, 10)", [tuteId]);
    await actAs(db, poster);
    mainRound = (await q(`select public.post_round_build($1, ${MONTH}, 'main') as id`, [batch]))[0].id;
    const parcels = await q("select id, number, full_name from public.post_parcels where round_id = $1", [mainRound]);
    expect(parcels).toHaveLength(1);
    expect(parcels[0].full_name).toBe("amal & bimal");
    expect((await q("select count(*)::int as n from public.post_parcel_items where parcel_id = $1", [parcels[0].id]))[0].n).toBe(2);
    expect(await onHand()).toBe(10);
    await asOwner(db);
    expect((await q("select public.tute_available($1) as n", [tuteId]))[0].n).toBe(8);

    // Hall handouts can't steal the 2 copies reserved for this Speed Post round.
    await actAs(db, stocker);
    const err = await db
      .query(`select public.tute_stock_issue($1, 9, 'class_issue', $2, ${MONTH})`, [tuteId, classId])
      .catch((e) => e);
    expect(err.code).toBe("P0001");
    expect(err.message).toMatch(/held for Speed Post/);
  });

  test("nobody gets the same tute twice; a top-up round picks up newly confirmed students", async () => {
    await actAs(db, poster);
    expect(await outcome(db, `select public.post_round_build($1, ${MONTH}, 'top_up')`, [batch])).toBe("P0001");
    await q("select public.post_addresses_confirm($1)", [[key("chamal")]]);
    const topUp = (await q(`select public.post_round_build($1, ${MONTH}, 'top_up') as id`, [batch]))[0].id;
    expect((await q("select full_name from public.post_parcels where round_id = $1", [topUp])).map((r) => r.full_name)).toEqual([
      "chamal",
    ]);
    // Taking the parcel out frees the copies again.
    const [p] = await q("select id from public.post_parcels where round_id = $1", [topUp]);
    await q("select public.post_parcel_void($1)", [p.id]);
    await asOwner(db);
    expect((await q("select public.tute_available($1) as n", [tuteId]))[0].n).toBe(8);
  });

  test("handover needs every parcel packed and tracked, posts stock out once, and is safe to repeat", async () => {
    await actAs(db, poster);
    const [p] = await q("select id from public.post_parcels where round_id = $1", [mainRound]);
    expect(await outcome(db, "select public.post_round_handover($1, 450)", [mainRound])).toBe("P0001");
    await q("select public.post_parcel_pack($1, true)", [p.id]);
    expect(await outcome(db, "select public.post_parcel_set_tracking($1, 'ab 12')", [p.id])).toBe("P0001");
    await q("select public.post_parcel_set_tracking($1, $2)", [p.id, `ee${stamp}lk`]);
    expect((await q("select tracking_no from public.post_parcels where id = $1", [p.id]))[0].tracking_no).toBe(`EE${stamp}LK`);

    expect((await q("select public.post_round_handover($1, 450) as n", [mainRound]))[0].n).toBe(1);
    expect((await q("select public.post_round_handover($1, 450) as n", [mainRound]))[0].n).toBe(0);
    expect(await onHand()).toBe(8);

    // Posted copies count toward total given, while hall_given tracks only class_issue.
    await actAs(db, stocker);
    const [sum] = await q(`select classes from public.tute_stock_summary(${MONTH}) where tute_id = $1`, [tuteId]);
    expect(sum.classes[0]).toMatchObject({ given: 2, hall_given: 0 });

    await asOwner(db);
    const status = await q("select status from public.tute_stock_reservations where round_id = $1", [mainRound]);
    expect(status).toEqual([{ status: "committed" }]);
  });

  test("a returned parcel puts usable copies back and can be sent again after the address is checked", async () => {
    await actAs(db, poster);
    const [p] = await q("select id from public.post_parcels where round_id = $1", [mainRound]);
    await q("select public.post_parcel_set_status($1, 'returned', true)", [p.id]);
    expect(await onHand()).toBe(10);
    await actAs(db, poster);
    expect((await q("select checked from public.student_addresses where student_key = $1", [key("amal")]))[0].checked).toBe(false);

    await q("select public.post_addresses_confirm($1)", [[key("amal"), key("bimal")]]);
    const resend = (await q(`select public.post_round_build($1, ${MONTH}, 'top_up') as id`, [batch]))[0].id;
    expect((await q("select count(*)::int as n from public.post_parcels where round_id = $1", [resend]))[0].n).toBe(2);
  });
});
