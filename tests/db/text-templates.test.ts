// Quick text templates: each member sees and changes only their own, up to 30.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let me: Actor;
let other: Actor;

const add = async (who: Actor, body: string) => {
  await actAs(db, who);
  return outcome(db, "insert into public.text_templates (body) values ($1)", [body]);
};
const mine = async (who: Actor) => {
  await actAs(db, who);
  return (await db.query("select body from public.text_templates order by created_at, body")).rows.map((r) => r.body);
};

beforeAll(async () => {
  db = await session();
  me = { kind: "user", id: await createPerson(db) };
  other = { kind: "user", id: await createPerson(db) };
});
afterAll(() => db.end());

describe("text templates", () => {
  test("a member saves templates and sees only their own", async () => {
    expect(await add(me, "Diagram for Q")).toBe("ok");
    expect(await add(other, "Fixed Q")).toBe("ok");
    expect(await mine(me)).toEqual(["Diagram for Q"]);
    expect(await mine(other)).toEqual(["Fixed Q"]);
  });

  test("the same template twice is refused", async () => {
    expect(await add(me, "Diagram for Q")).toBe("23505");
  });

  test("no one can save a template for someone else, or remove theirs", async () => {
    await actAs(db, other);
    expect(
      await outcome(db, "insert into public.text_templates (user_id, body) values ($1, 'sneaky')", [
        (me as { id: string }).id,
      ]),
    ).toBe("42501");
    await db.query("delete from public.text_templates where body = 'Diagram for Q'");
    expect(await mine(me)).toEqual(["Diagram for Q"]);
  });

  test("up to 30 each", async () => {
    for (let i = 1; i < 30; i++) expect(await add(me, `T${i}`)).toBe("ok");
    expect(await add(me, "one too many")).toBe("42501");
    await actAs(db, me);
    await db.query("delete from public.text_templates where body = 'T1'");
    expect(await add(me, "one too many")).toBe("ok");
  });

  test("signed-out visitors see nothing", async () => {
    await actAs(db, { kind: "anon" });
    expect(await outcome(db, "select * from public.text_templates")).toBe("42501");
    await asOwner(db);
  });
});
