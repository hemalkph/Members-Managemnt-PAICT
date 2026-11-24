// Monthly Class Fee Due Tracker & WhatsApp Reminders: RLS, class isolation,
// atomic monthly re-uploads preserving follow-ups, template defaults, and privacy.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let admin: Actor;
let memberEditor: Actor;
let memberViewer: Actor;
let memberNoAccess: Actor;
let batch = "";
const stamp = Date.now();

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

beforeAll(async () => {
  db = await session();
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  memberEditor = {
    kind: "user",
    id: await createPerson(db, { admin: false, pageAccess: { fee_reminders: "edit" } }),
    aal: "aal2",
  };
  memberViewer = {
    kind: "user",
    id: await createPerson(db, { admin: false, pageAccess: { fee_reminders: "view" } }),
    aal: "aal2",
  };
  memberNoAccess = { kind: "user", id: await createPerson(db, { admin: false }), aal: "aal2" };
  batch = await createBatch(db);
});

afterAll(() => db.end());

describe("fee_reminders access control", () => {
  test("grants read/write via has_page('fee_reminders') and enforces aal2", async () => {
    await actAs(db, memberNoAccess);
    expect((await q("select public.has_page('fee_reminders') as ok"))[0].ok).toBe(false);
    expect(await outcome(db, "select public.fee_class_save(null, $1, 'No Access Class', true)", [batch])).toBe("42501");

    await actAs(db, memberViewer);
    expect((await q("select public.has_page('fee_reminders') as ok"))[0].ok).toBe(true);
    expect((await q("select public.has_page('fee_reminders', true) as ok"))[0].ok).toBe(false);
    expect(await outcome(db, "select public.fee_class_save(null, $1, 'Viewer Class', true)", [batch])).toBe("42501");

    await actAs(db, { ...memberEditor, aal: "aal1" } as Actor);
    expect((await q("select public.has_page('fee_reminders') as ok"))[0].ok).toBe(false);

    await actAs(db, memberEditor);
    expect((await q("select public.has_page('fee_reminders', true) as ok"))[0].ok).toBe(true);
  });
});

describe("class isolation, re-uploads, follow-ups, and templates", () => {
  let revisionId = "";
  let theoryId = "";

  test("supports multiple isolated classes in one batch and atomic month imports", async () => {
    await actAs(db, memberEditor);
    revisionId = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `Grand Revision ${stamp}`]))[0].id;
    theoryId = (await q("select public.fee_class_save(null, $1, $2, true) as id", [batch, `Theory ${stamp}`]))[0].id;
    expect(revisionId).not.toBe(theoryId);

    const octRows = [
      {
        student_key: "wa:94713377422",
        full_name: "Ayodya Karunasena",
        email_norm: "ayodgim@gmail.com",
        raw_email: "ayodgim@gmail.com",
        whatsapp_norm: "94713377422",
        raw_whatsapp: "0713377422",
        mobile_norm: "94713377422",
        raw_mobile: "0713377422",
        institute: "Online",
        district: "Ratnapura",
        is_new_student: false,
        amount: "3000",
        export_label: "",
        raw_classes: "2027 Grand Revision - October Class (2027 A/L)",
      },
      {
        student_key: "wa:94774309816",
        full_name: "Malintha Lakshan",
        email_norm: "lakshanmalintha75@gmail.com",
        raw_email: "lakshanmalintha75@gmail.com",
        whatsapp_norm: "94774309816",
        raw_whatsapp: "774309816",
        mobile_norm: "94774309816",
        raw_mobile: "774309816",
        institute: "Online",
        district: "Ampara",
        is_new_student: false,
        amount: "3000",
        export_label: "Half card",
        raw_classes: "2027 Grand Revision - October Class (2027 A/L)",
      },
    ];

    const inserted = (
      await q("select public.fee_month_replace_import($1, '2026-10-01', 'oct.xlsx', 3, 1, $2::jsonb) as n", [
        revisionId,
        JSON.stringify(octRows),
      ])
    )[0].n;
    expect(inserted).toBe(2);

    // Theory class remains completely isolated (0 rows).
    expect(await q("select * from public.fee_month_students where class_id = $1", [theoryId])).toHaveLength(0);
    expect(await q("select * from public.fee_month_students where class_id = $1 and month = '2026-10-01'", [revisionId])).toHaveLength(2);
  });

  test("preserves WhatsApp follow-up history & labels when the current month is re-uploaded", async () => {
    await actAs(db, memberEditor);
    const f1 = (
      await q(
        "select * from public.fee_followup_set($1, '2026-11-01', 'wa:94713377422', 'Ayodya Karunasena', 'ayodgim@gmail.com', '94713377422', 'messaged', 'Promised Friday', 'Replied on WA', null, true)",
        [revisionId],
      )
    )[0];
    expect(f1.status).toBe("messaged");
    expect(f1.message_count).toBe(1);
    expect(f1.label).toBe("Promised Friday");

    // Re-upload November paid list -> follow-up must stay untouched!
    await q("select public.fee_month_replace_import($1, '2026-11-01', 'nov-updated.xlsx', 1, 0, $2::jsonb)", [
      revisionId,
      JSON.stringify([
        {
          student_key: "wa:94774309816",
          full_name: "Malintha Lakshan",
          email_norm: "malinthalakshan428@gmail.com",
          raw_email: "malinthalakshan428@gmail.com",
          whatsapp_norm: "94774309816",
          raw_whatsapp: "94774309816",
          mobile_norm: "94774309816",
          raw_mobile: "94774309816",
          institute: "Online",
          district: "Ampara",
          is_new_student: true,
          amount: "3000",
          export_label: "",
          raw_classes: "2027 Grand Revision - November Class (2027 A/L)",
        },
      ]),
    ]);

    const after = await q("select status, message_count, label, note from public.fee_due_followups where class_id = $1 and due_month = '2026-11-01'", [
      revisionId,
    ]);
    expect(after).toEqual([{ status: "messaged", message_count: 1, label: "Promised Friday", note: "Replied on WA" }]);
  });

  test("manages customizable emoji templates with a single default", async () => {
    await actAs(db, memberEditor);
    const seeded = await q("select id, is_default from public.fee_message_templates");
    expect(seeded.length).toBeGreaterThanOrEqual(2);
    expect(seeded.filter((t) => t.is_default)).toHaveLength(1);

    const sinhalaBody =
      "ආයුබෝවන් {first_name} 🔔 *{class}* — *{month_si}* මාසයේ ගාස්තුව ගෙවීම් ක්‍රමය හරහා සිදු කරන්න (විද්‍යා ප්‍රශ්න පත්‍ර) 🙏✨";
    const newId = (
      await q("select public.fee_template_save(null, $1, $2, true) as id", [
        `Final Notice ${stamp}`,
        sinhalaBody,
      ])
    )[0].id;

    const saved = await q("select id, body from public.fee_message_templates where is_default");
    expect(saved).toEqual([{ id: newId, body: sinhalaBody }]);

    await q("select public.fee_template_delete($1)", [newId]);
    // Deleting the default promotes another template so one default always remains.
    expect(await q("select id from public.fee_message_templates where is_default")).toHaveLength(1);
  });

  test("concession cross-labels respect Concession students privacy boundary", async () => {
    await actAs(db, admin);
    await q("select public.concession_student_save($1::jsonb)", [
      JSON.stringify({
        student_no: `FC${stamp}`,
        full_name: "Ayodya Karunasena",
        batch_id: batch,
        card_type: "free",
      }),
    ]);

    // Admin has both fee_reminders and students -> sees card label.
    const adminLabels = await q("select full_name, card_type from public.fee_batch_concession_labels($1)", [batch]);
    expect(adminLabels).toEqual([{ full_name: "Ayodya Karunasena", card_type: "free" }]);

    // Member with ONLY fee_reminders (no students page) -> receives empty set (no privacy leak!).
    await actAs(db, memberEditor);
    const memberLabels = await q("select full_name, card_type from public.fee_batch_concession_labels($1)", [batch]);
    expect(memberLabels).toHaveLength(0);

    await asOwner(db);
    expect(await q("select 1 from public.activity_log where action = 'fee.imported'")).toHaveLength(2);
  });

  test("manages month-specific & future-month class tutes from one shared shelf", async () => {
    const otherBatch = await createBatch(db);

    // Tutes are created on Tute stock; Fee reminders can't create, rename or delete them.
    await actAs(db, memberEditor);
    expect(await outcome(db, "select public.tute_save(null, 'Blocked', '')")).toBe("42501");
    const stockKeeper: Actor = {
      kind: "user",
      id: await createPerson(db, { pageAccess: { tutes: "edit" } }),
      aal: "aal2",
    };
    await actAs(db, stockKeeper);
    const t1 = (await q("select public.tute_save(null, $1, 'T-07') as id", ["ඒකකය 07 - දත්ත සමුදාය ප්‍රශ්න"]))[0].id;
    const t2 = (await q("select public.tute_save(null, 'SQL Practice Workbook', 'T-08') as id"))[0].id;
    // Names and codes are unique on the whole shelf.
    expect(await outcome(db, "select public.tute_save(null, 'sql practice workbook', '')")).toBe("P0001");
    expect(await outcome(db, "select public.tute_save(null, 'Another workbook', 't-08')")).toBe("P0001");

    // Fee reminders picks them one by one for each month: Nov and future Feb 2027 for t1, Nov for t2.
    await actAs(db, memberEditor);
    expect(await outcome(db, "select public.class_tute_delete($1)", [t2])).toBe("42501");
    await q("select public.class_month_tute_attach($1, '2026-11-01', $2, 'Speed Post')", [revisionId, t1]);
    await q("select public.class_month_tute_attach($1, '2027-02-01', $2, '')", [revisionId, t1]);
    await q("select public.class_month_tute_attach($1, '2026-11-01', $2, '')", [revisionId, t2]);

    // Scheduled in Nov (2 tutes) and future Feb 2027 (1 tute).
    const novLinks = await q(
      "select id, tute_id, sort_order from public.class_month_tutes where class_id = $1 and month = '2026-11-01' order by sort_order",
      [revisionId],
    );
    expect(novLinks.map((r) => r.tute_id)).toEqual([t1, t2]);
    expect(
      await q("select 1 from public.class_month_tutes where class_id = $1 and month = '2027-02-01'", [revisionId]),
    ).toHaveLength(1);

    // Reorder Nov tutes (t2 before t1).
    await q("select public.class_month_tute_reorder($1, '2026-11-01', array[$2::uuid, $3::uuid])", [
      revisionId,
      novLinks[1].id,
      novLinks[0].id,
    ]);
    const reordered = await q(
      "select tute_id from public.class_month_tutes where class_id = $1 and month = '2026-11-01' order by sort_order",
      [revisionId],
    );
    expect(reordered.map((r) => r.tute_id)).toEqual([t2, t1]);

    // Reuse catalog tute t1 in sibling class (Theory) in same batch -> allowed!
    await q("select public.class_month_tute_attach($1, '2027-03-01', $2, 'Future revision')", [theoryId, t1]);
    expect(
      await q("select 1 from public.class_month_tutes where class_id = $1 and month = '2027-03-01'", [theoryId]),
    ).toHaveLength(1);

    // A class in another batch can take the same tute (one shelf for every batch).
    const otherClassId = (await q("select public.fee_class_save(null, $1, $2, true) as id", [otherBatch, `Other ${stamp}`]))[0].id;
    await q("select public.class_month_tute_attach($1, '2026-11-01', $2, '')", [otherClassId, t1]);
    expect(await q("select 1 from public.class_month_tutes where class_id = $1 and tute_id = $2", [otherClassId, t1])).toHaveLength(1);

    // Removing from Nov unlinks only Nov (catalog & Feb 2027 stay intact).
    await q("select public.class_month_tute_remove($1)", [novLinks[0].id]);
    expect(
      await q("select 1 from public.class_month_tutes where class_id = $1 and month = '2027-02-01'", [revisionId]),
    ).toHaveLength(1);

    // Read-only viewer can read tutes but cannot mutate them.
    await actAs(db, memberViewer);
    expect(await q("select id from public.class_tutes where id = $1", [t1])).toHaveLength(1);
    expect(
      await outcome(db, "select public.tute_save($1, 'Blocked', '')", [t1]),
    ).toBe("42501");
  });
});
