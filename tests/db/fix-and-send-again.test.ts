// Fix and send again: a member can fix their rejected work (it goes back to
// pending, keeps the admin's reason, and admins hear about it), and a task an
// admin sent back comes with a reason the member can't change.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let admin: Actor;
let member: Actor;
let role = "";

const id = (a: Actor) => (a as { id: string }).id;
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

beforeAll(async () => {
  db = await session();
  admin = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  member = { kind: "user", id: await createPerson(db), aal: "aal1" };
  await asOwner(db);
  const section = (await q("insert into public.sections (name) values ('Resend test') returning id"))[0].id;
  role = (await q("insert into public.roles (section_id, name) values ($1, 'Designer') returning id", [section]))[0].id;
  await q("insert into public.member_roles (user_id, role_id) values ($1, $2)", [id(member), role]);
});
afterAll(() => db.end());

const logWork = async () => {
  await actAs(db, member);
  return (
    await q(
      `insert into public.submissions (user_id, role_id, work_month, title, quantity, date_done)
       values ($1, $2, current_date, 'Poster', 1, current_date) returning id`,
      [id(member), role],
    )
  )[0].id as string;
};
const reject = async (sub: string) => {
  await actAs(db, admin);
  await q("update public.submissions set status = 'rejected', admin_comment = 'Wrong size' where id = $1", [sub]);
};

describe("rejected work", () => {
  test("the member fixes it and it goes back to review with the reason kept", async () => {
    const sub = await logWork();
    await reject(sub);
    await actAs(db, member);
    expect(await outcome(db, "update public.submissions set quantity = 2, status = 'pending' where id = $1", [sub])).toBe("ok");
    await asOwner(db);
    const [row] = await q("select status, admin_comment, resubmitted_at, reviewed_at from public.submissions where id = $1", [sub]);
    expect(row.status).toBe("pending");
    expect(row.admin_comment).toBe("Wrong size");
    expect(row.resubmitted_at).not.toBeNull();
    expect(row.reviewed_at).toBeNull();
    const [note] = await q(
      "select body from public.notifications where user_id = $1 and kind = 'review.pending' order by created_at desc limit 1",
      [id(admin)],
    );
    expect(note.body).toContain("fixed and sent again");
  });

  test("the member can't approve it, change the reason, or edit it without sending it again", async () => {
    const sub = await logWork();
    await reject(sub);
    await actAs(db, member);
    expect(await outcome(db, "update public.submissions set status = 'approved' where id = $1", [sub])).not.toBe("ok");
    await actAs(db, member);
    expect(
      await outcome(db, "update public.submissions set status = 'pending', admin_comment = null where id = $1", [sub]),
    ).toBe("42501");
    await actAs(db, member);
    // Still rejected: a plain edit matches no row the member may change into a rejected one.
    await q("update public.submissions set quantity = 5 where id = $1", [sub]).catch(() => null);
    await asOwner(db);
    expect((await q("select quantity, status from public.submissions where id = $1", [sub]))[0]).toEqual({
      quantity: 1,
      status: "rejected",
    });
  });

  test("approved work stays locked", async () => {
    const sub = await logWork();
    await actAs(db, admin);
    await q("update public.submissions set status = 'approved' where id = $1", [sub]);
    await actAs(db, member);
    await q("update public.submissions set status = 'pending' where id = $1", [sub]).catch(() => null);
    await asOwner(db);
    expect((await q("select status from public.submissions where id = $1", [sub]))[0].status).toBe("approved");
  });
});

describe("tasks sent back", () => {
  test("the member is told why, and can't change or clear the reason", async () => {
    await asOwner(db);
    const task = (
      await q("insert into public.tasks (title, assignee_id, created_by, status) values ('Banner', $1, $2, 'done') returning id", [
        id(member),
        id(admin),
      ])
    )[0].id;
    await actAs(db, admin);
    await q("update public.tasks set status = 'open', fix_note = 'Use the new logo', sent_back_at = now() where id = $1", [task]);
    await asOwner(db);
    const [note] = await q("select title, body from public.notifications where user_id = $1 and kind = 'task.sent_back'", [
      id(member),
    ]);
    expect(note).toEqual({ title: "Fix and send again: Banner", body: "Use the new logo" });

    await actAs(db, member);
    expect(await outcome(db, "update public.tasks set fix_note = null where id = $1", [task])).toBe("42501");
    await actAs(db, member);
    expect(await outcome(db, "update public.tasks set status = 'done' where id = $1", [task])).toBe("ok");
  });
});
