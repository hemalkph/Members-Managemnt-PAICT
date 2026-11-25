// Renewals: outcomes for unpaid students, call owners, daily snapshots,
// "paid since" marking and the 9:00 notices.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let admin: Actor;
let editor: Actor;
let viewer: Actor;
let studentsViewer: Actor;
let nobody: Actor;
let nobodyId = "";
let clsA = "";
let clsB = "";
const stamp = Date.now();
const nameA = `Renew A ${stamp}`;
const M = "date_trunc('month', now() at time zone 'Asia/Colombo')::date";
const TODAY = "(now() at time zone 'Asia/Colombo')::date";

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

/** Record an outcome as the given actor (named arguments keep it readable). */
const outcomeSql = (extra = "") =>
  `select public.fee_followup_outcome(p_class_id => $1, p_due_month => ${M}, p_student_key => $2, p_student_name => $2,
     p_whatsapp_norm => null, p_outcome => $3${extra})`;

async function followup(key: string) {
  await asOwner(db);
  return (await q(`select * from public.fee_due_followups where class_id = $1 and due_month = ${M} and student_key = $2`, [clsA, key]))[0];
}

async function noticesFor(actor: Actor, kind: string) {
  await asOwner(db);
  const id = actor.kind === "user" ? actor.id : "";
  return (
    await q("select count(*)::int as n from public.notifications where user_id = $1 and kind = $2 and title like $3", [
      id,
      kind,
      `%${nameA}%`,
    ])
  )[0].n as number;
}

beforeAll(async () => {
  db = await session();
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  editor = { kind: "user", id: await createPerson(db, { pageAccess: { fee_reminders: "edit" } }), aal: "aal2" };
  viewer = { kind: "user", id: await createPerson(db, { pageAccess: { fee_reminders: "view" } }), aal: "aal2" };
  studentsViewer = { kind: "user", id: await createPerson(db, { pageAccess: { students: "view" } }), aal: "aal2" };
  nobodyId = await createPerson(db);
  nobody = { kind: "user", id: nobodyId, aal: "aal2" };
  const batch = await createBatch(db);
  await actAs(db, admin);
  clsA = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, nameA]))[0].id;
  clsB = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `Renew B ${stamp}`]))[0].id;
});

afterAll(() => db.end());

describe("renewals", () => {
  test("access", async () => {
    await actAs(db, viewer);
    expect(await outcome(db, outcomeSql(), [clsA, "v1", "excused"])).toBe("42501");
    expect(await outcome(db, "select public.fee_class_owner_set($1, null)", [clsA])).toBe("42501");
    expect(await outcome(db, "select public.fee_renewal_settings_set(10, 90)")).toBe("42501");
    expect(await outcome(db, `select public.fee_renewal_record($1, ${M}, 0, 0, 0, '{}')`, [clsB])).toBe("ok");
    expect(await outcome(db, `select * from public.fee_renewal_history(${M})`)).toBe("ok");
    expect(await outcome(db, "select * from public.fee_renewal_settings()")).toBe("ok");
    await actAs(db, nobody);
    expect(await outcome(db, `select * from public.fee_renewal_history(${M})`)).toBe("42501");
    await actAs(db, admin);
    expect(await outcome(db, "select public.send_renewal_notices()")).toBe("42501");
    expect(
      await outcome(db, `select public.followup_needs_call(f, ${TODAY}) from public.fee_due_followups f limit 1`),
    ).toBe("42501");
  });

  test("promised needs a future date", async () => {
    await actAs(db, editor);
    expect(await outcome(db, outcomeSql(`, p_promised_by => ${TODAY} - 1`), [clsA, "p1", "promised"])).toBe("P0001");
    expect(await outcome(db, outcomeSql(), [clsA, "p1", "promised"])).toBe("P0001");
    await q(outcomeSql(`, p_promised_by => ${TODAY} + 3`), [clsA, "p1", "promised"]);
    const row = await followup("p1");
    expect(row).toMatchObject({ status: "promised", call_count: 1 });
    expect(row.promised_by).not.toBeNull();
  });

  test("outcome rules", async () => {
    await actAs(db, editor);
    expect(await outcome(db, outcomeSql(), [clsA, "d1", "dropped"])).toBe("P0001");
    await q(outcomeSql(", p_reason => 'money'"), [clsA, "d1", "dropped"]);
    expect(await followup("d1")).toMatchObject({ status: "dropped", reason: "money" });

    await actAs(db, editor);
    expect(await outcome(db, outcomeSql(", p_moved_to => $1"), [clsA, "m1", "moved_class"])).toBe("P0001");
    await q(outcomeSql(", p_moved_to => $4"), [clsA, "m1", "moved_class", clsB]);
    expect((await followup("m1")).moved_to_class).toBe(clsB);

    await actAs(db, editor);
    expect(await outcome(db, outcomeSql(), [clsA, "x1", "maybe"])).toBe("P0001");
    await q(
      `select public.fee_followup_set($1, ${M}, 'n1', 'n1', '', null, 'messaged', null, null, null, true)`,
      [clsA],
    );
    await q(outcomeSql(), [clsA, "n1", "no_answer"]);
    expect(await followup("n1")).toMatchObject({ status: "messaged", call_count: 1, message_count: 1 });
    await actAs(db, editor);
    await q(outcomeSql(", p_called => false"), [clsA, "n1", "no_answer"]);
    expect((await followup("n1")).call_count).toBe(1);
  });

  test("old dialog still saves new statuses", async () => {
    await actAs(db, editor);
    expect(
      await outcome(db, `select public.fee_followup_set($1, ${M}, 'p1', 'p1', '', null, 'promised', null, 'call Friday', null, false)`, [
        clsA,
      ]),
    ).toBe("ok");
  });

  test("one snapshot per day", async () => {
    await actAs(db, viewer);
    await q(`select public.fee_renewal_record($1, ${M}, 10, 4, 1, '{}')`, [clsB]);
    await q(`select public.fee_renewal_record($1, ${M}, 10, 6, 2, '{}')`, [clsB]);
    const rows = await q(`select * from public.fee_renewal_history(${M}) where class_id = $1`, [clsB]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ prev_total: 10, renewed: 6, new_students: 2 });
  });

  test("record marks paid follow-ups", async () => {
    await actAs(db, editor);
    for (const key of ["k1", "k2"]) {
      await q(`select public.fee_followup_set($1, ${M}, $2, $2, '', null, 'messaged', null, null, null, true)`, [clsA, key]);
    }
    await q(`select public.fee_renewal_record($1, ${M}, 10, 6, 2, array['k2'])`, [clsA]);
    expect((await followup("k1")).paid_seen_at).not.toBeNull();
    expect((await followup("k2")).paid_seen_at).toBeNull();
    await actAs(db, editor);
    await q(`select public.fee_renewal_record($1, ${M}, 10, 6, 2, array['k1','k2','p1','d1','m1','n1'])`, [clsA]);
    expect((await followup("k1")).paid_seen_at).toBeNull();
  });

  test("past month records no snapshot", async () => {
    await actAs(db, editor);
    await q(`select public.fee_renewal_record($1, (${M} - interval '1 month')::date, 5, 1, 0, '{}')`, [clsB]);
    await asOwner(db);
    expect(
      (await q(`select count(*)::int as n from public.fee_renewal_snapshots where class_id = $1 and month <> ${M}`, [clsB]))[0].n,
    ).toBe(0);
  });

  test("call notices", async () => {
    await actAs(db, editor);
    await q("select public.fee_class_owner_set($1, $2)", [clsA, editor.kind === "user" ? editor.id : null]);
    await asOwner(db);
    await q(
      `update public.fee_due_followups set message_count = 2, last_messaged_at = now() - interval '3 days'
       where class_id = $1 and due_month = ${M} and student_key = 'k2'`,
      [clsA],
    );
    await q("select public.send_renewal_notices()");
    expect(await noticesFor(editor, "fee.calls_due")).toBe(1);
    expect(await noticesFor(viewer, "fee.calls_due")).toBe(0);
    await q("select public.send_renewal_notices()");
    expect(await noticesFor(editor, "fee.calls_due")).toBe(1);

    await actAs(db, editor);
    await q("select public.fee_class_owner_set($1, null)", [clsA]);
    await asOwner(db);
    await q("select public.send_renewal_notices()");
    expect(await noticesFor(viewer, "fee.calls_due")).toBe(1);

    const needs = async () =>
      (
        await q(
          `select public.followup_needs_call(f, ${TODAY}) as n from public.fee_due_followups f
           where class_id = $1 and due_month = ${M} and student_key = 'k2'`,
          [clsA],
        )
      )[0].n;
    expect(await needs()).toBe(true);
    await q(`update public.fee_due_followups set paid_seen_at = now() where class_id = $1 and student_key = 'k2'`, [clsA]);
    expect(await needs()).toBe(false);
  });

  test("cant afford notice", async () => {
    await actAs(db, editor);
    await q(outcomeSql(), [clsA, "c1", "cant_afford"]);
    await asOwner(db);
    await q("select public.send_renewal_notices()");
    expect(await noticesFor(studentsViewer, "fee.cant_afford")).toBe(1);
  });

  test("settings", async () => {
    await actAs(db, viewer);
    expect((await q("select * from public.fee_renewal_settings()"))[0]).toEqual({ due_day: 10, target_pct: 90 });
    await actAs(db, editor);
    expect(await outcome(db, "select public.fee_renewal_settings_set(0, 80)")).toBe("P0001");
    expect(await outcome(db, "select public.fee_renewal_settings_set(10, 120)")).toBe("P0001");
    await q("select public.fee_renewal_settings_set(15, 80)");
    expect((await q("select * from public.fee_renewal_settings()"))[0]).toEqual({ due_day: 15, target_pct: 80 });
    await q("select public.fee_renewal_settings_set(10, 90)");
  });

  test("owner must have access", async () => {
    await actAs(db, editor);
    expect(await outcome(db, "select public.fee_class_owner_set($1, $2)", [clsA, nobodyId])).toBe("P0001");
  });
});
