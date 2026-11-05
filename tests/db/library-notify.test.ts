// Paper library notifications: the Physical Coordinator and the LMS Admin are
// told once per paper and language when it reaches the library.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { asOwner, createPerson, session } from "./helpers";

let db: pg.Client;
let paper = "";
let admin = "";
let lms = "";
let coordinator = "";
let other = "";

const STAGES = [
  ["create_si", 1], ["typeset_si", 2], ["convert", 3], ["typeset_en", 4], ["review_si", 5], ["review_en", 6], ["handover", 7],
] as const;

const setStage = (stage: string, status: string) =>
  db.query("update public.paper_stages set status = $3 where paper_id = $1 and stage = $2", [paper, stage, status]);
const addFile = (stage: string, version = 1) =>
  db.query(
    `insert into public.paper_files (paper_id, stage, version, storage_path, file_name, size_bytes, uploaded_by)
     values ($1, $2, $3, $4, 'p.pdf', 10, $5)`,
    [paper, stage, version, `${paper}/${stage}/v${version}.pdf`, admin],
  );
const inbox = async (user: string) =>
  (await db.query("select title, body from public.notifications where user_id = $1 and kind = 'library.new' order by id", [user])).rows;

beforeAll(async () => {
  db = await session();
  admin = await createPerson(db, { mainAdmin: true });
  lms = await createPerson(db);
  coordinator = await createPerson(db);
  other = await createPerson(db);
  await asOwner(db);
  const section = (await db.query("insert into public.sections (name) values ('Notify test') returning id")).rows[0].id;
  const role = async (name: string) =>
    (await db.query("insert into public.roles (section_id, name) values ($1, $2) returning id", [section, name])).rows[0].id;
  const lmsRole = await role("LMS Admin (notify test)");
  const printRole = await role("Physical Coordinator (notify test)");
  const otherRole = await role("Typist (notify test)");
  await db.query("insert into public.member_roles (user_id, role_id) values ($1, $2), ($3, $4), ($5, $6)", [
    lms, lmsRole, coordinator, printRole, other, otherRole,
  ]);
  paper = (await db.query("insert into public.papers (title, created_by) values ('RFP 09 - MCQ', $1) returning id", [admin])).rows[0].id;
  for (const [stage, position] of STAGES) {
    await db.query("insert into public.paper_stages (paper_id, stage, position, status) values ($1, $2, $3, 'waiting')", [
      paper, stage, position,
    ]);
  }
  await addFile("typeset_si");
  await addFile("typeset_en");
});
afterAll(() => db.end());

describe("library notifications", () => {
  test("nothing while the paper is still in review", async () => {
    for (const s of ["create_si", "typeset_si", "convert", "typeset_en"]) await setStage(s, "done");
    expect(await inbox(lms)).toEqual([]);
    expect(await inbox(coordinator)).toEqual([]);
  });

  test("Sinhala review done → LMS Admin and Physical Coordinator are told, with their own job", async () => {
    await setStage("review_si", "done");
    expect(await inbox(lms)).toEqual([
      { title: "New in the paper library: RFP 09 - MCQ – Sinhala", body: "Download it and add it to the LMS." },
    ]);
    expect(await inbox(coordinator)).toEqual([
      { title: "New in the paper library: RFP 09 - MCQ – Sinhala", body: "Download it and send it for printing." },
    ]);
    expect(await inbox(other)).toEqual([]);
  });

  test("a review reopened and done again doesn't send it twice", async () => {
    await setStage("review_si", "in_progress");
    await setStage("review_si", "done");
    expect(await inbox(lms)).toHaveLength(1);
  });

  test("English review, then the hand-over PDF uploaded later, each send one more", async () => {
    await setStage("review_en", "done");
    expect((await inbox(coordinator)).map((n) => n.title)).toEqual([
      "New in the paper library: RFP 09 - MCQ – Sinhala",
      "New in the paper library: RFP 09 - MCQ – English",
    ]);
    await addFile("handover");
    expect((await inbox(coordinator)).at(-1)?.title).toBe("New in the paper library: RFP 09 - MCQ – final PDF");
    expect(await inbox(lms)).toHaveLength(3);
  });
});
