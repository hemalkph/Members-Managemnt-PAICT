// Student results: a member given the results page sees names and marks only,
// never the private student tables; marks are checked against each part.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let admin: Actor;
let marker: Actor;
let viewer: Actor;
let other: Actor;
let batch = "";
let exam = "";
let mcq = "";
let essay = "";
let student = "";
let ended = "";

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const save = async (who: Actor, rows: unknown[]) => {
  await actAs(db, who);
  return outcome(db, "select public.concession_results_save($1, $2::jsonb)", [exam, JSON.stringify(rows)]);
};

beforeAll(async () => {
  db = await session();
  admin = { kind: "user", id: await createPerson(db, { admin: true }), aal: "aal2" };
  marker = { kind: "user", id: await createPerson(db, { pageAccess: { student_results: "edit" } }), aal: "aal2" };
  viewer = { kind: "user", id: await createPerson(db, { pageAccess: { student_results: "view" } }), aal: "aal2" };
  other = { kind: "user", id: await createPerson(db), aal: "aal2" };
  batch = await createBatch(db);
  await asOwner(db);
  exam = (await q("insert into public.exams (batch_id, name, exam_date) values ($1, 'Term Test 1', '2026-11-10') returning id", [batch]))[0].id;

  await actAs(db, admin);
  const add = async (no: string) =>
    (
      await q("select public.concession_student_save($1::jsonb) as id", [
        JSON.stringify({ student_no: no, full_name: `Student ${no}`, batch_id: batch, card_type: "free" }),
      ])
    )[0].id as string;
  student = await add(`R${Date.now()}`);
  ended = await add(`E${Date.now()}`);
  await q("select public.concession_student_set_card($1, 'free', 'ended', 'Left the class')", [ended]);
});
afterAll(() => db.end());

describe("exam parts", () => {
  test("results editors add parts; viewers and other members can't", async () => {
    await actAs(db, marker);
    mcq = (await q("insert into public.exam_parts (exam_id, name, max_marks) values ($1, 'Paper I', 40) returning id", [exam]))[0].id;
    essay = (await q("insert into public.exam_parts (exam_id, name, max_marks, sort_order) values ($1, 'Paper II', 60, 1) returning id", [exam]))[0].id;
    for (const who of [viewer, other]) {
      await actAs(db, who);
      expect(await outcome(db, "insert into public.exam_parts (exam_id, name, max_marks) values ($1, 'X', 10)", [exam])).toBe("42501");
    }
  });
});

describe("entering results", () => {
  test("the marker saves attendance and marks", async () => {
    expect(await save(marker, [{ student_id: student, attendance: "present", marks: { [mcq]: "35", [essay]: "48.5" } }])).toBe("ok");
    await asOwner(db);
    const rows = await q(
      "select sum(m.marks)::text as total from public.concession_part_marks m join public.concession_results r on r.id = m.result_id where r.student_id = $1",
      [student],
    );
    expect(rows[0].total).toBe("83.50");
  });

  test("marks above a part's full marks are refused", async () => {
    expect(await save(marker, [{ student_id: student, attendance: "present", marks: { [mcq]: "41" } }])).toBe("P0001");
  });

  test("absent keeps no marks", async () => {
    expect(await save(marker, [{ student_id: student, attendance: "absent", marks: { [mcq]: "30" } }])).toBe("ok");
    await asOwner(db);
    expect(await q("select 1 from public.concession_part_marks m join public.concession_results r on r.id = m.result_id where r.student_id = $1", [student])).toHaveLength(0);
  });

  test("viewers and other members can't save", async () => {
    expect(await save(viewer, [{ student_id: student, attendance: "present" }])).toBe("42501");
    expect(await save(other, [{ student_id: student, attendance: "present" }])).toBe("42501");
  });

  test("a student from another batch is refused", async () => {
    const otherBatch = await createBatch(db);
    await actAs(db, admin);
    const [{ id }] = await q("select public.concession_student_save($1::jsonb) as id", [
      JSON.stringify({ student_no: `O${Date.now()}`, full_name: "Other Batch", batch_id: otherBatch, card_type: "half" }),
    ]);
    expect(await save(marker, [{ student_id: id, attendance: "present" }])).toBe("P0001");
  });

  test("lowering full marks below entered marks is refused", async () => {
    expect(await save(marker, [{ student_id: student, attendance: "present", marks: { [essay]: "55" } }])).toBe("ok");
    await actAs(db, marker);
    expect(await outcome(db, "update public.exam_parts set max_marks = 50 where id = $1", [essay])).toBe("P0001");
  });
});

describe("what the marker sees", () => {
  test("the roster has names and card types, not ended students without a result", async () => {
    await actAs(db, marker);
    const roster = await q("select * from public.concession_roster($1)", [exam]);
    expect(roster.map((r) => r.student_id)).toEqual([student]);
    expect(Object.keys(roster[0]).sort()).toEqual(["card_type", "centre_id", "full_name", "student_id", "student_no"]);
  });

  test("the marker can't read any private student table", async () => {
    await actAs(db, marker);
    for (const t of ["concession_students", "concession_student_private", "concession_guardians", "concession_documents", "concession_card_history"]) {
      expect(await q(`select 1 from public.${t}`)).toHaveLength(0);
    }
    expect((await q("select 1 from public.concession_results")).length).toBeGreaterThan(0);
  });

  test("other members see no results and can't open the roster", async () => {
    await actAs(db, other);
    expect(await q("select 1 from public.concession_results")).toHaveLength(0);
    expect(await outcome(db, "select * from public.concession_roster($1)", [exam])).toBe("42501");
  });

  test("without two-step the marker gets nothing", async () => {
    await actAs(db, { kind: "user", id: (marker as { id: string }).id, aal: "aal1" });
    expect(await q("select 1 from public.concession_results")).toHaveLength(0);
  });
});
