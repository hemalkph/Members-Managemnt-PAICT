// Paper library: each language shows once its own review is done; marking
// schemes show once every marking-scheme step is finished.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, session, type Actor } from "./helpers";

let db: pg.Client;
let member: Actor;
let paper = "";

const STAGES = [
  ["create_si", 1], ["typeset_si", 2], ["convert", 3], ["typeset_en", 4], ["review_si", 5], ["review_en", 6],
  ["handover", 7], ["scheme", 8], ["scheme_rewrite", 9], ["scheme_en", 10], ["mark", 11],
] as const;

const setStages = async (status: string, positions: number[]) => {
  await asOwner(db);
  await db.query("update public.paper_stages set status = $2 where paper_id = $1 and position = any($3::int[])", [
    paper,
    status,
    positions,
  ]);
};
const library = async () => {
  await actAs(db, member);
  return (await db.query("select stage, version from public.paper_library() where paper_id = $1 order by stage", [paper])).rows;
};
const canOpen = async (stage: string) => {
  await actAs(db, member);
  return (await db.query("select 1 from public.paper_files where paper_id = $1 and stage = $2", [paper, stage])).rows.length > 0;
};

beforeAll(async () => {
  db = await session();
  const adminId = await createPerson(db, { mainAdmin: true });
  member = { kind: "user", id: await createPerson(db), aal: "aal2" };
  await asOwner(db);
  paper = (await db.query("insert into public.papers (title, created_by) values ('Lib RFP 05', $1) returning id", [adminId])).rows[0].id;
  for (const [stage, position] of STAGES) {
    await db.query("insert into public.paper_stages (paper_id, stage, position, status) values ($1, $2, $3, 'waiting')", [
      paper,
      stage,
      position,
    ]);
  }
  for (const [stage, version] of [["typeset_si", 1], ["typeset_si", 2], ["typeset_en", 1], ["scheme", 1], ["scheme_en", 1]] as const) {
    await db.query(
      `insert into public.paper_files (paper_id, stage, version, storage_path, file_name, size_bytes, uploaded_by)
       values ($1, $2, $3, $4, 'p.pdf', 10, $5)`,
      [paper, stage, version, `${paper}/${stage}/v${version}.pdf`, adminId],
    );
  }
});
afterAll(() => db.end());

describe("paper library", () => {
  test("nothing shows while the paper is still being made and reviewed", async () => {
    await setStages("done", [1, 2, 3, 4]); // no review finished yet
    expect(await library()).toEqual([]);
    expect(await canOpen("typeset_si")).toBe(false);
  });

  test("the Sinhala paper shows once the Sinhala review is done – it doesn't wait for English", async () => {
    await setStages("done", [5]);
    expect(await library()).toEqual([{ stage: "typeset_si", version: 2 }]);
    expect(await canOpen("typeset_si")).toBe(true);
    expect(await canOpen("typeset_en")).toBe(false);
  });

  test("the English paper follows its own review; no marking scheme yet", async () => {
    await setStages("done", [6]);
    expect(await library()).toEqual([
      { stage: "typeset_en", version: 1 },
      { stage: "typeset_si", version: 2 },
    ]);
    expect(await canOpen("scheme")).toBe(false);
  });

  test("marking schemes only once every scheme step is finished", async () => {
    await setStages("done", [8]);
    expect((await library()).map((r) => r.stage)).not.toContain("scheme");
    await setStages("skipped", [9]);
    await setStages("done", [10]);
    expect((await library()).map((r) => r.stage)).toEqual(["scheme", "scheme_en", "typeset_en", "typeset_si"]);
    expect(await canOpen("scheme_en")).toBe(true);
  });

  test("a cancelled paper leaves the library", async () => {
    await asOwner(db);
    await db.query("update public.papers set status = 'cancelled' where id = $1", [paper]);
    expect(await library()).toEqual([]);
    await asOwner(db);
    await db.query("update public.papers set status = 'in_progress' where id = $1", [paper]);
  });

  test("storage follows the same rule", async () => {
    await asOwner(db);
    await db.query("insert into storage.buckets (id, name) values ('papers', 'papers') on conflict do nothing");
    await db.query("insert into storage.objects (bucket_id, name) values ('papers', $1), ('papers', $2)", [
      `${paper}/typeset_si/v2.pdf`,
      `${paper}/create_si/v1.pdf`,
    ]);
    await actAs(db, member);
    const rows = (await db.query("select name from storage.objects where bucket_id = 'papers' and name like $1 order by name", [`${paper}/%`])).rows;
    expect(rows.map((r) => r.name)).toEqual([`${paper}/typeset_si/v2.pdf`]);
  });
});
