// Concession students: only people with the Students page see anything (admins
// by default, members only when given it); verifying needs the GN certificate, parent occupation,
// consent and (Half / Paid card) the monthly amount; every change is logged.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let mainAdmin: Actor;
let admin: Actor;
let viewer: Actor;
let hidden: Actor;
let member: Actor;
let staff: Actor;
let batch = "";

const id = (a: Actor) => (a as { id: string }).id;
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const TABLES = [
  "concession_students",
  "concession_student_private",
  "concession_guardians",
  "concession_documents",
  "concession_card_history",
];

async function addStudent(who: Actor, extra: Record<string, unknown> = {}) {
  await actAs(db, who);
  const no = `S${Math.floor(Math.random() * 1e8)}`;
  const [row] = await q("select public.concession_student_save($1::jsonb) as id", [
    JSON.stringify({ student_no: no, full_name: "Nimal Perera", batch_id: batch, card_type: "half", ...extra }),
  ]);
  return row.id as string;
}

const setCard = async (who: Actor, sid: string, card: string, status: string, note = "") => {
  await actAs(db, who);
  return outcome(db, "select public.concession_student_set_card($1, $2, $3, $4)", [sid, card, status, note]);
};

beforeAll(async () => {
  db = await session();
  mainAdmin = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  viewer = { kind: "user", id: await createPerson(db, { admin: true, pageAccess: { students: "view" } }), aal: "aal2" };
  hidden = { kind: "user", id: await createPerson(db, { admin: true, pageAccess: { students: "none" } }), aal: "aal2" };
  member = { kind: "user", id: await createPerson(db), aal: "aal2" };
  staff = { kind: "user", id: await createPerson(db, { pageAccess: { students: "edit" } }), aal: "aal2" };
  batch = await createBatch(db);
});
afterAll(() => db.end());

describe("who can see and change students", () => {
  test("admins add students; read-only admins, hidden admins and members can't", async () => {
    expect(await addStudent(admin)).toBeTruthy();
    for (const who of [viewer, hidden, member]) {
      await actAs(db, who);
      expect(
        await outcome(db, "select public.concession_student_save($1::jsonb)", [
          JSON.stringify({ student_no: "X1", full_name: "Kamal", batch_id: batch, card_type: "free" }),
        ]),
      ).toBe("42501");
    }
  });

  test("a member given the page works like an admin, private details included", async () => {
    const sid = await addStudent(staff);
    expect(sid).toBeTruthy();
    await actAs(db, staff);
    expect(await q("select 1 from public.concession_student_private where student_id = $1", [sid])).toHaveLength(1);
    await actAs(db, { kind: "user", id: id(staff), aal: "aal1" });
    expect(await q("select 1 from public.concession_students where id = $1", [sid])).toHaveLength(0);
  });

  test("main admins see every student", async () => {
    const sid = await addStudent(admin);
    await actAs(db, mainAdmin);
    expect(await q("select 1 from public.concession_student_private where student_id = $1", [sid])).toHaveLength(1);
  });

  test("an admin without two-step sees nothing", async () => {
    await addStudent(admin);
    await actAs(db, { kind: "user", id: id(admin), aal: "aal1" });
    for (const t of TABLES) expect(await q(`select 1 from public.${t}`)).toHaveLength(0);
  });

  test("members, hidden admins and anon see no rows in any table", async () => {
    for (const who of [member, hidden]) {
      await actAs(db, who);
      for (const t of TABLES) expect(await q(`select 1 from public.${t}`)).toHaveLength(0);
    }
    await actAs(db, { kind: "anon" });
    for (const t of TABLES) expect(await outcome(db, `select 1 from public.${t}`)).toBe("42501");
  });

  test("read-only admins see students but can't add guardians", async () => {
    const sid = await addStudent(admin);
    await actAs(db, viewer);
    expect((await q("select 1 from public.concession_students where id = $1", [sid])).length).toBe(1);
    expect(
      await outcome(
        db,
        "insert into public.concession_guardians (student_id, relationship, full_name, occupation) values ($1, 'mother', 'Kumari', 'Teacher')",
        [sid],
      ),
    ).toBe("42501");
  });

  test("nobody writes the student or history tables directly", async () => {
    const sid = await addStudent(admin);
    await actAs(db, admin);
    expect(await outcome(db, "update public.concession_students set status = 'verified' where id = $1", [sid])).toBe("42501");
    expect(
      await outcome(db, "insert into public.concession_card_history (student_id, card_type, status) values ($1, 'free', 'verified')", [sid]),
    ).toBe("42501");
  });

  test("a student ID can only be registered once", async () => {
    await actAs(db, admin);
    const payload = JSON.stringify({ student_no: "DUP-1", full_name: "A Student", batch_id: batch, card_type: "free" });
    expect(await outcome(db, "select public.concession_student_save($1::jsonb)", [payload])).toBe("ok");
    expect(await outcome(db, "select public.concession_student_save($1::jsonb)", [payload])).toBe("P0001");
  });
});

describe("verifying", () => {
  test("needs the certificate, division, date, parent occupation, consent and amount", async () => {
    const sid = await addStudent(admin);
    await actAs(db, admin);
    const [{ missing }] = await q("select public.concession_missing($1) as missing", [sid]);
    expect(missing).toEqual([
      "GN certificate file",
      "GN division",
      "Certificate date",
      "Parent occupation",
      "Parents' consent",
      "Monthly amount",
    ]);
    expect(await setCard(admin, sid, "half", "verified")).toBe("P0001");
  });

  test("a complete student can be verified, and it is logged", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const sid = await addStudent(admin, {
      gn_division: "Maharagama 528",
      certificate_issued_on: today,
      consent_on: today,
      monthly_amount: 1500,
    });
    await actAs(db, admin);
    await q(
      "insert into public.concession_guardians (student_id, relationship, full_name, occupation) values ($1, 'father', 'Sunil', 'Farmer')",
      [sid],
    );
    await q(
      "insert into public.concession_documents (student_id, storage_path, file_name, size_bytes, uploaded_by) values ($1, $2, 'gn.pdf', 100, $3)",
      [sid, `${sid}/gn.pdf`, id(admin)],
    );
    expect(await setCard(admin, sid, "half", "verified")).toBe("ok");

    await asOwner(db);
    const [p] = await q("select verified_by from public.concession_student_private where student_id = $1", [sid]);
    expect(p.verified_by).toBe(id(admin));
    const actions = (await q("select action from public.activity_log where entity_id = $1 order by id", [sid])).map((r) => r.action);
    expect(actions).toEqual(["student.added", "student.document_added", "student.verified"]);

    // Moving to a Free card drops the amount and needs a reason.
    expect(await setCard(admin, sid, "free", "verified")).toBe("P0001");
    expect(await setCard(admin, sid, "free", "verified", "Father lost his job")).toBe("ok");
    await asOwner(db);
    const [after] = await q("select monthly_amount from public.concession_student_private where student_id = $1", [sid]);
    expect(after.monthly_amount).toBeNull();
    expect((await q("select 1 from public.concession_card_history where student_id = $1", [sid])).length).toBe(3);

    // Verified students can't be deleted.
    await actAs(db, admin);
    expect(await outcome(db, "select public.concession_student_delete($1)", [sid])).toBe("P0001");
  });

  test("an old certificate is not enough", async () => {
    const sid = await addStudent(admin, { gn_division: "X", certificate_issued_on: "2020-01-01" });
    await actAs(db, admin);
    const [{ missing }] = await q("select public.concession_missing($1) as missing", [sid]);
    expect(missing).toContain("A certificate from the last 12 months");
  });
});

describe("certificates", () => {
  test("a file row must sit in the student's folder", async () => {
    const sid = await addStudent(admin);
    await actAs(db, admin);
    expect(
      await outcome(
        db,
        "insert into public.concession_documents (student_id, storage_path, file_name, size_bytes, uploaded_by) values ($1, 'other/x.pdf', 'x.pdf', 10, $2)",
        [sid, id(admin)],
      ),
    ).toBe("42501");
  });

  test("storage: only editors upload, only page users read", async () => {
    const sid = await addStudent(admin);
    await actAs(db, admin);
    expect(await outcome(db, "insert into storage.objects (bucket_id, name) values ('concession', $1)", [`${sid}/a.pdf`])).toBe("ok");
    await actAs(db, viewer);
    expect(await outcome(db, "insert into storage.objects (bucket_id, name) values ('concession', $1)", [`${sid}/b.pdf`])).toBe("42501");
    expect((await q("select 1 from storage.objects where bucket_id = 'concession'")).length).toBeGreaterThan(0);
    await actAs(db, member);
    expect(await q("select 1 from storage.objects where bucket_id = 'concession'")).toHaveLength(0);
    expect(await outcome(db, "insert into storage.objects (bucket_id, name) values ('concession', $1)", [`${sid}/c.pdf`])).toBe("42501");
  });

  test("opening a certificate is logged; members can't call it", async () => {
    const sid = await addStudent(admin);
    await actAs(db, admin);
    const [doc] = await q(
      "insert into public.concession_documents (student_id, storage_path, file_name, size_bytes, uploaded_by) values ($1, $2, 'gn.jpg', 10, $3) returning id",
      [sid, `${sid}/gn.jpg`, id(admin)],
    );
    await actAs(db, viewer);
    expect(await outcome(db, "select public.concession_document_opened($1)", [doc.id])).toBe("ok");
    await actAs(db, member);
    expect(await outcome(db, "select public.concession_document_opened($1)", [doc.id])).toBe("42501");
    await asOwner(db);
    expect(
      await q("select 1 from public.activity_log where action = 'student.document_opened' and actor_id = $1", [id(viewer)]),
    ).toHaveLength(1);
  });
});

describe("deleting", () => {
  test("a student added by mistake can be deleted, with its files listed for removal", async () => {
    const sid = await addStudent(admin);
    await actAs(db, admin);
    await q(
      "insert into public.concession_documents (student_id, storage_path, file_name, size_bytes, uploaded_by) values ($1, $2, 'gn.pdf', 10, $3)",
      [sid, `${sid}/gn.pdf`, id(admin)],
    );
    const [{ paths }] = await q("select public.concession_student_delete($1) as paths", [sid]);
    expect(paths).toEqual([`${sid}/gn.pdf`]);
    await asOwner(db);
    expect(await q("select 1 from public.concession_students where id = $1", [sid])).toHaveLength(0);
  });
});
