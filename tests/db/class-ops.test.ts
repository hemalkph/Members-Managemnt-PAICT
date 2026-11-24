// Classes page: page access, class mode (Physical / Online / Both), typed
// "paid so far" counts feeding the tute forecast, and scheduling tutes.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, createTute, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let admin: Actor;
let classEditor: Actor;
let classViewer: Actor;
let nobody: Actor;
let batch = "";
const stamp = Date.now();
const THIS_MONTH = "date_trunc('month', now() at time zone 'Asia/Colombo')::date";

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

beforeAll(async () => {
  db = await session();
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  classEditor = { kind: "user", id: await createPerson(db, { pageAccess: { class_ops: "edit" } }), aal: "aal2" };
  classViewer = { kind: "user", id: await createPerson(db, { pageAccess: { class_ops: "view" } }), aal: "aal2" };
  nobody = { kind: "user", id: await createPerson(db), aal: "aal2" };
  batch = await createBatch(db);
});

afterAll(() => db.end());

describe("classes", () => {
  test("the Classes page can add classes with a mode; others can't", async () => {
    await actAs(db, classEditor);
    const id = (await q("select public.fee_class_save(null, $1, $2, true, 'online') as id", [batch, `Online ${stamp}`]))[0].id;
    expect(await outcome(db, "select public.fee_class_save(null, $1, 'Bad mode', true, 'hybrid')", [batch])).toBe("P0001");
    // Editing without a mode keeps the mode.
    await q("select public.fee_class_save($1, $2, $3, true)", [id, batch, `Online renamed ${stamp}`]);
    await asOwner(db);
    expect((await q("select name, mode from public.fee_classes where id = $1", [id]))[0]).toEqual({
      name: `Online renamed ${stamp}`,
      mode: "online",
    });

    await actAs(db, classViewer);
    expect(await outcome(db, "select * from public.class_ops_overview(current_date)")).toBe("ok");
    expect(await outcome(db, "select public.fee_class_save(null, $1, 'Viewer class', true)", [batch])).toBe("42501");
    expect(await outcome(db, "select public.class_paid_count_save($1, 5)", [id])).toBe("42501");
    await actAs(db, nobody);
    expect(await outcome(db, "select * from public.class_ops_overview(current_date)")).toBe("42501");
  });

  test("a typed paid count counts like an upload, and the newest one wins", async () => {
    await actAs(db, classEditor);
    const id = (await q("select public.fee_class_save(null, $1, $2, true, 'physical') as id", [batch, `Typed ${stamp}`]))[0].id;
    await asOwner(db);
    await q(
      `insert into public.fee_month_imports (class_id, month, unique_student_count, uploaded_at)
       values ($1, ${THIS_MONTH}, 40, now() - interval '1 hour')`,
      [id],
    );
    expect((await q(`select public.class_paid_count($1, ${THIS_MONTH}) as n`, [id]))[0].n).toBe(40);

    await actAs(db, classEditor);
    expect(await outcome(db, "select public.class_paid_count_save($1, -1)", [id])).toBe("P0001");
    await q("select public.class_paid_count_save($1, 55)", [id]);
    const [row] = await q(`select * from public.class_ops_overview(${THIS_MONTH}) where class_id = $1`, [id]);
    expect(row).toMatchObject({ paid: 55, paid_source: "typed", mode: "physical" });
    expect(row.expected).toBeGreaterThanOrEqual(55);

    await asOwner(db);
    expect((await q(`select public.tute_expected_students($1, ${THIS_MONTH}) as n`, [id]))[0].n).toBeGreaterThanOrEqual(55);
    // Deleting the uploaded list keeps the typed count.
    await q(`delete from public.fee_month_imports where class_id = $1 and month = ${THIS_MONTH}`, [id]);
    expect((await q(`select public.class_paid_count($1, ${THIS_MONTH}) as n`, [id]))[0].n).toBe(55);
  });

  test("a Classes editor schedules tutes for classes in any batch", async () => {
    const otherBatch = await createBatch(db);
    await actAs(db, admin);
    const tute = await createTute(db, (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `Theory ${stamp}`]))[0].id, `Unit 30 ${stamp}`, []);
    const other = (await q("select public.fee_class_save(null, $1, $2, true) as id", [otherBatch, `Revision ${stamp}`]))[0].id;

    await actAs(db, classEditor);
    const link = (await q(`select public.class_month_tute_attach($1, ${THIS_MONTH}, $2) as id`, [other, tute]))[0].id;
    expect((await q(`select tutes_this from public.class_ops_overview(${THIS_MONTH}) where class_id = $1`, [other]))[0].tutes_this).toBe(1);
    await q("select public.class_month_tute_remove($1)", [link]);
    await actAs(db, classViewer);
    expect(await outcome(db, `select public.class_month_tute_attach($1, ${THIS_MONTH}, $2)`, [other, tute])).toBe("42501");
  });
});

describe("mode decides Online and Physical", () => {
  test("an Online class posts to everyone, a Physical class to no one", async () => {
    await actAs(db, admin);
    const online = (await q("select public.fee_class_save(null, $1, $2, true, 'online') as id", [batch, `All online ${stamp}`]))[0].id;
    const physical = (await q("select public.fee_class_save(null, $1, $2, true, 'physical') as id", [batch, `All hall ${stamp}`]))[0].id;
    await asOwner(db);
    for (const [cls, key, institute] of [
      [online, `on-a-${stamp}`, "Hall"],
      [online, `on-b-${stamp}`, ""],
      [physical, `ph-a-${stamp}`, "Online"],
    ]) {
      await q(
        `insert into public.fee_month_students (class_id, month, student_key, full_name, institute)
         values ($1, ${THIS_MONTH}, $2, $2, $3)`,
        [cls, key, institute],
      );
    }
    expect((await q(`select public.tute_online_share($1, ${THIS_MONTH}) as s`, [online]))[0].s).toBe("1");
    expect((await q(`select public.tute_online_share($1, ${THIS_MONTH}) as s`, [physical]))[0].s).toBe("0");

    await actAs(db, admin);
    const keys = (await q(`select student_key from public.post_month_students($1, ${THIS_MONTH})`, [batch])).map(
      (r) => r.student_key,
    );
    expect(keys).toEqual(expect.arrayContaining([`on-a-${stamp}`, `on-b-${stamp}`]));
    expect(keys).not.toContain(`ph-a-${stamp}`);
  });
});
