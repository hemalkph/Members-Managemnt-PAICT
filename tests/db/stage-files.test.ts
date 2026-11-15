// Several files per stage: the owner marks the correct paper (one per stage),
// others can't, the next stages are told about late files, and the library
// uses the correct paper over a newer file.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let creator: Actor;
let converter: Actor;
let typesetter: Actor;
let stranger: Actor;
let paper = "";

const id = (a: Actor) => (a as { id: string }).id;
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

const addFile = async (stage: string, version: number, tag: string, who: Actor) => {
  await asOwner(db);
  return (
    await q(
      `insert into public.paper_files (paper_id, stage, version, storage_path, file_name, size_bytes, tag, uploaded_by)
       values ($1, $2, $3, $4, $5, 10, $6, $7) returning id`,
      [paper, stage, version, `${paper}/${stage}/v${version}.pdf`, `${tag}-${version}.pdf`, tag, id(who)],
    )
  )[0].id as string;
};
const mains = async (stage: string) => {
  await asOwner(db);
  return (await q("select file_name from public.paper_files where paper_id = $1 and stage = $2 and is_main", [paper, stage])).map(
    (r) => r.file_name,
  );
};
const inbox = async (who: Actor) => {
  await asOwner(db);
  return q("select title, body from public.notifications where user_id = $1 and kind = 'paper.files'", [id(who)]);
};

beforeAll(async () => {
  db = await session();
  const admin = await createPerson(db, { mainAdmin: true });
  creator = { kind: "user", id: await createPerson(db, { name: "Kamal Perera" }) };
  converter = { kind: "user", id: await createPerson(db) };
  typesetter = { kind: "user", id: await createPerson(db) };
  stranger = { kind: "user", id: await createPerson(db) };
  await asOwner(db);
  paper = (await q("insert into public.papers (title, created_by) values ('Stage files paper', $1) returning id", [admin]))[0].id;
  for (const [stage, position, owner, status] of [
    ["create_si", 1, creator, "done"],
    ["typeset_si", 2, typesetter, "in_progress"],
    ["convert", 3, converter, "in_progress"],
    ["review_si", 5, creator, "waiting"],
  ] as const) {
    await q("insert into public.paper_stages (paper_id, stage, position, owner_id, status) values ($1, $2, $3, $4, $5)", [
      paper,
      stage,
      position,
      id(owner),
      status,
    ]);
  }
});
afterAll(() => db.end());

describe("correct paper", () => {
  let first = "";
  let images = "";
  let corrected = "";

  test("the owner marks one file; marking another moves the mark", async () => {
    first = await addFile("create_si", 1, "paper", creator);
    images = await addFile("create_si", 2, "images", creator);
    corrected = await addFile("create_si", 3, "corrected", creator);
    await actAs(db, creator);
    await q("select public.set_main_paper_file($1)", [first]);
    expect(await mains("create_si")).toEqual(["paper-1.pdf"]);
    await actAs(db, creator);
    await q("select public.set_main_paper_file($1)", [corrected]);
    expect(await mains("create_si")).toEqual(["corrected-3.pdf"]);
  });

  test("someone else on the paper, or a stranger, can't mark it", async () => {
    await actAs(db, converter);
    expect(await outcome(db, "select public.set_main_paper_file($1)", [images])).toBe("42501");
    await actAs(db, stranger);
    expect(await outcome(db, "select public.set_main_paper_file($1)", [images])).toBe("42501");
    expect(await mains("create_si")).toEqual(["corrected-3.pdf"]);
  });

  test("a stage that hasn't started can't be marked yet", async () => {
    const marked = await addFile("review_si", 1, "marked", creator);
    await actAs(db, creator);
    expect(await outcome(db, "select public.set_main_paper_file($1)", [marked])).toBe("42501");
  });

  test("two correct papers in one stage are refused", async () => {
    await asOwner(db);
    expect(await outcome(db, "update public.paper_files set is_main = true where id = $1", [images])).toBe("23505");
  });
});

describe("telling the next stages", () => {
  test("late files reach the type setter and converter, not the sender or strangers", async () => {
    const extra = await addFile("create_si", 4, "images", creator);
    await actAs(db, creator);
    expect((await q("select public.notify_stage_files($1, 'create_si', $2) as n", [paper, [extra]]))[0].n).toBe(2);
    const [msg] = await inbox(typesetter);
    expect(msg.title).toBe("New files: Stage files paper – Create (Sinhala)");
    expect(msg.body).toBe("Kamal Perera added 1 file. Images: images-4.pdf");
    expect(await inbox(converter)).toHaveLength(1);
    expect(await inbox(creator)).toEqual([]);
    expect(await inbox(stranger)).toEqual([]);
  });

  test("only the stage owner can send it", async () => {
    await actAs(db, stranger);
    expect(await outcome(db, "select public.notify_stage_files($1, 'create_si', $2)", [paper, []])).toBe("42501");
  });
});

describe("editing file details", () => {
  const edit = async (who: Actor, file: string, name: string, tag = "images", note = "") => {
    await actAs(db, who);
    return outcome(db, "select public.update_paper_file($1, $2, $3, $4)", [file, name, tag, note]);
  };
  const row = async (file: string) => {
    await asOwner(db);
    return (await q("select file_name, tag, note from public.paper_files where id = $1", [file]))[0];
  };

  test("the owner renames a file, says what it is and adds a remark", async () => {
    const file = await addFile("create_si", 5, "other", creator);
    expect(await edit(creator, file, "  Q3 diagram.png ", "images", " for Q3 (b) ")).toBe("ok");
    expect(await row(file)).toEqual({ file_name: "Q3 diagram.png", tag: "images", note: "for Q3 (b)" });
    expect(await edit(creator, file, "Q3 diagram.png", "images", "")).toBe("ok");
    expect((await row(file)).note).toBeNull();
  });

  test("the next stage's owner or a stranger can't edit it", async () => {
    const file = await addFile("create_si", 6, "images", creator);
    expect(await edit(converter, file, "renamed.png")).toBe("42501");
    expect(await edit(stranger, file, "renamed.png")).toBe("42501");
    expect((await row(file)).file_name).toBe("images-6.pdf");
  });

  test("an empty name or an unknown tag is refused", async () => {
    const file = await addFile("create_si", 7, "images", creator);
    expect(await edit(creator, file, "   ")).toBe("P0001");
    expect(await edit(creator, file, "ok.png", "poster")).toBe("23514");
  });
});

describe("library", () => {
  test("uses the correct paper over a newer file", async () => {
    await asOwner(db);
    await q("insert into public.paper_stages (paper_id, stage, position, owner_id, status) values ($1, 'review_en', 6, $2, 'done')", [
      paper,
      id(creator),
    ]);
    await q("update public.paper_stages set status = 'done' where paper_id = $1", [paper]);
    const good = await addFile("typeset_si", 1, "paper", typesetter);
    await addFile("typeset_si", 2, "images", typesetter);
    await asOwner(db);
    await q("update public.paper_files set is_main = true where id = $1", [good]);
    await actAs(db, { ...typesetter, aal: "aal2" } as Actor);
    const rows = await q("select file_id from public.paper_library() where paper_id = $1 and stage = 'typeset_si'", [paper]);
    expect(rows).toEqual([{ file_id: good }]);
  });
});
