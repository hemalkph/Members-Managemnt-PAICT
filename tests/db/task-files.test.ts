// Task files: admins add the brief, the assignee adds their work, other
// members see nothing, and a file stops being "new" when the other side opens it.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let admin: Actor;
let member: Actor;
let other: Actor;
let task = "";

const id = (a: Actor) => (a as { id: string }).id;
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

const addFile = async (who: Actor, kind: "brief" | "work", path = `${task}/${kind}/${Date.now()}-${Math.random()}.pdf`) => {
  await actAs(db, who);
  return outcome(
    db,
    `insert into public.task_files (task_id, kind, storage_path, file_name, size_bytes, uploaded_by)
     values ($1, $2, $3, 'a.pdf', 10, $4)`,
    [task, kind, path, id(who)],
  );
};
const addObject = async (who: Actor, kind: string) => {
  await actAs(db, who);
  return outcome(db, "insert into storage.objects (bucket_id, name) values ('tasks', $1)", [`${task}/${kind}/x-${Math.random()}.pdf`]);
};

beforeAll(async () => {
  db = await session();
  admin = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  member = { kind: "user", id: await createPerson(db) };
  other = { kind: "user", id: await createPerson(db) };
  await asOwner(db);
  task = (
    await q("insert into public.tasks (title, assignee_id, created_by) values ('Type set Paper 2', $1, $2) returning id", [
      id(member),
      id(admin),
    ])
  )[0].id;
});
afterAll(() => db.end());

describe("adding files", () => {
  test("admin adds the brief, the member can't", async () => {
    expect(await addFile(admin, "brief")).toBe("ok");
    expect(await addFile(member, "brief")).toBe("42501");
  });
  test("the assignee adds work, another member can't", async () => {
    expect(await addFile(member, "work")).toBe("ok");
    expect(await addFile(other, "work")).toBe("42501");
  });
  test("the path must match the task and kind", async () => {
    expect(await addFile(member, "work", `${task}/brief/sneaky.pdf`)).toBe("42501");
  });
  test("storage follows the same rules", async () => {
    expect(await addObject(admin, "brief")).toBe("ok");
    expect(await addObject(member, "work")).toBe("ok");
    expect(await addObject(member, "brief")).toBe("42501");
    expect(await addObject(other, "work")).toBe("42501");
  });
  test("no work on a cancelled task", async () => {
    await asOwner(db);
    await q("update public.tasks set status = 'cancelled' where id = $1", [task]);
    expect(await addFile(member, "work")).toBe("42501");
    await asOwner(db);
    await q("update public.tasks set status = 'open' where id = $1", [task]);
  });
});

describe("reading and new files", () => {
  test("only people on the task see its files", async () => {
    await actAs(db, member);
    expect((await q("select 1 from public.task_files where task_id = $1", [task])).length).toBeGreaterThan(0);
    await actAs(db, other);
    expect(await q("select 1 from public.task_files where task_id = $1", [task])).toHaveLength(0);
  });

  test("a brief is new until the member opens it; opening your own file changes nothing", async () => {
    await asOwner(db);
    const [brief] = await q("select id from public.task_files where task_id = $1 and kind = 'brief' limit 1", [task]);
    await actAs(db, admin);
    await q("select public.task_file_seen($1)", [brief.id]);
    await asOwner(db);
    expect((await q("select seen_at from public.task_files where id = $1", [brief.id]))[0].seen_at).toBeNull();

    await actAs(db, member);
    await q("select public.task_file_seen($1)", [brief.id]);
    await asOwner(db);
    expect((await q("select seen_at from public.task_files where id = $1", [brief.id]))[0].seen_at).not.toBeNull();
  });

  test("members can't edit file rows directly", async () => {
    await actAs(db, member);
    await q("update public.task_files set seen_at = null where task_id = $1", [task]);
    await asOwner(db);
    expect(await q("select 1 from public.task_files where task_id = $1 and kind = 'brief' and seen_at is null", [task])).toHaveLength(0);
  });

  test("the admin is told when work arrives", async () => {
    await asOwner(db);
    expect(await q("select 1 from public.notifications where user_id = $1 and kind = 'task.files'", [id(admin)])).toHaveLength(1);
  });
});

describe("removing files", () => {
  test("another member can't remove the member's work; the member can", async () => {
    await asOwner(db);
    const [work] = await q("select id from public.task_files where task_id = $1 and kind = 'work' limit 1", [task]);
    await actAs(db, other);
    expect((await q("delete from public.task_files where id = $1 returning id", [work.id])).length).toBe(0);
    await actAs(db, member);
    expect((await q("delete from public.task_files where id = $1 returning id", [work.id])).length).toBe(1);
  });
});
