// Security hardening (migration 043), checked the way a hand-made API request
// would hit the database: two-step is enforced by the database, ordinary admins
// can't touch main admins, and reviewing work needs Work review edit access.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let admin: Actor; // ordinary admin who entered the two-step code
let adminNoCodeId = ""; // ordinary admin who never set up two-step
let reviewViewOnly: Actor; // ordinary admin whose Work review is view-only
let adminTwoStepId = ""; // ordinary admin with an authenticator app
let memberTwoStepId = ""; // member with an authenticator app
let mainId = "";
let main: Actor;
let memberId = "";
let role = "";

const as = (id: string, aal: "aal1" | "aal2"): Actor => ({ kind: "user", id, aal });
const rows = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const count = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rowCount ?? 0;
const turnOnTwoStep = async (id: string) => {
  await asOwner(db);
  await db.query("insert into auth.mfa_factors (user_id) values ($1)", [id]);
};

beforeAll(async () => {
  db = await session();
  admin = as(await createPerson(db, { admin: true }), "aal2");
  adminNoCodeId = await createPerson(db, { admin: true });
  reviewViewOnly = as(await createPerson(db, { admin: true, pageAccess: { review: "view" } }), "aal2");
  adminTwoStepId = await createPerson(db, { admin: true });
  memberTwoStepId = await createPerson(db);
  mainId = await createPerson(db, { mainAdmin: true });
  main = as(mainId, "aal2");
  memberId = await createPerson(db);
  await turnOnTwoStep(adminTwoStepId);
  await turnOnTwoStep(memberTwoStepId);
  await turnOnTwoStep(mainId);

  await asOwner(db);
  await db.query(
    `insert into public.bank_details (user_id, bank_name, branch, account_holder, account_number)
     values ($1, 'Test Bank', 'Kandy', 'Test Holder', '1234567890')`,
    [memberTwoStepId],
  );
  const section = (await db.query("insert into public.sections (name) values ('Security test') returning id")).rows[0]
    .id;
  role = (await db.query("insert into public.roles (section_id, name) values ($1, 'Checker') returning id", [section]))
    .rows[0].id;
  for (const id of [memberId, (admin as { id: string }).id]) {
    await db.query("insert into public.member_roles (user_id, role_id) values ($1, $2)", [id, role]);
  }
});
afterAll(() => db.end());

/** A pending submission by this person (inserted as the owner of the database). */
const pendingWork = async (userId: string) => {
  await asOwner(db);
  return (
    await rows(
      `insert into public.submissions (user_id, role_id, work_month, title, quantity, date_done)
       values ($1, $2, date_trunc('month', current_date)::date, 'Checked work', 1, current_date) returning id`,
      [userId, role],
    )
  )[0].id as string;
};

describe("two-step is enforced by the database", () => {
  test("an admin with two-step on has no admin powers with a password-only session", async () => {
    await actAs(db, as(adminTwoStepId, "aal1"));
    expect((await rows("select public.is_admin() as ok"))[0].ok).toBe(false);
    expect(await count("select id from public.profiles")).toBe(1); // only their own profile
    expect(await count("update public.profiles set full_name = 'Changed' where id = $1", [memberId])).toBe(0);
    expect((await rows("select public.has_page('members', true) as ok"))[0].ok).toBe(false);
  });

  test("the same admin has their powers after entering the code", async () => {
    await actAs(db, as(adminTwoStepId, "aal2"));
    expect((await rows("select public.is_admin() as ok"))[0].ok).toBe(true);
    expect(await count("select id from public.profiles")).toBeGreaterThan(1);
  });

  test("an admin who never set up two-step has no admin powers until they do", async () => {
    await actAs(db, as(adminNoCodeId, "aal1"));
    expect((await rows("select public.is_admin() as ok"))[0].ok).toBe(false);
    expect((await rows("select public.has_page('review', true) as ok"))[0].ok).toBe(false);
    expect(await count("select id from public.profiles")).toBe(1);
    await actAs(db, admin);
    expect((await rows("select public.is_admin() as ok"))[0].ok).toBe(true);
  });

  test("a member with two-step on can't read their bank details with a password-only session", async () => {
    await actAs(db, as(memberTwoStepId, "aal1"));
    expect(await count("select user_id from public.bank_details")).toBe(0);
    await actAs(db, as(memberTwoStepId, "aal2"));
    expect(await count("select user_id from public.bank_details")).toBe(1);
  });
});

describe("only main admins can change a main admin's account", () => {
  test("an ordinary admin can't deactivate, demote or re-address a main admin", async () => {
    await actAs(db, admin);
    expect(await outcome(db, "update public.profiles set is_active = false where id = $1", [mainId])).toBe("42501");
    expect(await outcome(db, "update public.profiles set email = 'x@example.test' where id = $1", [mainId])).toBe(
      "42501",
    );
  });

  test("an ordinary admin can't delete a main admin's profile", async () => {
    await actAs(db, admin);
    expect(await count("delete from public.profiles where id = $1", [mainId])).toBe(0);
    await asOwner(db);
    expect(await count("select id from public.profiles where id = $1", [mainId])).toBe(1);
  });

  test("an ordinary admin can still deactivate a member, and a main admin a main admin's details", async () => {
    await actAs(db, admin);
    expect(await outcome(db, "update public.profiles set is_active = false where id = $1", [memberId])).toBe("ok");
    await asOwner(db);
    await db.query("update public.profiles set is_active = true where id = $1", [memberId]);
    await actAs(db, main);
    expect(await outcome(db, "update public.profiles set full_name = 'Main renamed' where id = $1", [mainId])).toBe(
      "ok",
    );
  });
});

describe("reviewing work needs Work review edit access, and not your own work", () => {
  test("an admin with Work review view-only can't approve", async () => {
    const id = await pendingWork(memberId);
    await actAs(db, reviewViewOnly);
    expect(await outcome(db, "update public.submissions set status = 'approved' where id = $1", [id])).toBe("42501");
  });

  test("an ordinary admin can't approve their own work, nor add it already approved", async () => {
    const id = await pendingWork((admin as { id: string }).id);
    await actAs(db, admin);
    expect(await outcome(db, "update public.submissions set status = 'approved' where id = $1", [id])).toBe("42501");
    expect(
      await outcome(
        db,
        `insert into public.submissions (user_id, role_id, work_month, title, quantity, date_done, status)
         values ($1, $2, date_trunc('month', current_date)::date, 'Self approved', 1, current_date, 'approved')`,
        [(admin as { id: string }).id, role],
      ),
    ).toBe("42501");
  });

  test("an admin with review access approves a member's work and is stamped as reviewer", async () => {
    const id = await pendingWork(memberId);
    await actAs(db, admin);
    expect(await outcome(db, "update public.submissions set status = 'approved' where id = $1", [id])).toBe("ok");
    await asOwner(db);
    const [row] = await rows("select status, reviewed_by from public.submissions where id = $1", [id]);
    expect(row.status).toBe("approved");
    expect(row.reviewed_by).toBe((admin as { id: string }).id);
  });

  test("an admin can still edit their own pending work without reviewing it", async () => {
    const id = await pendingWork((admin as { id: string }).id);
    await actAs(db, admin);
    expect(await outcome(db, "update public.submissions set quantity = 2 where id = $1", [id])).toBe("ok");
  });
});

describe("approval is bound to the version the admin saw", () => {
  test("a member's edit after the admin opened the page makes the approval match nothing", async () => {
    const id = await pendingWork(memberId);
    await asOwner(db);
    const [{ seen }] = await rows("select updated_at::text as seen from public.submissions where id = $1", [id]);

    // The member raises the quantity after the admin loaded the review page.
    await actAs(db, as(memberId, "aal1"));
    expect(await outcome(db, "update public.submissions set quantity = 500 where id = $1", [id])).toBe("ok");

    // The approval sent with the old version changes nothing.
    await actAs(db, admin);
    expect(
      await count("update public.submissions set status = 'approved' where id = $1 and updated_at = $2::timestamptz", [
        id,
        seen,
      ]),
    ).toBe(0);
    await asOwner(db);
    expect((await rows("select status from public.submissions where id = $1", [id]))[0].status).toBe("pending");
  });
});

describe("bank details: admins read, only main admins change someone else's", () => {
  test("an ordinary admin can read a member's bank details but not change or delete them", async () => {
    await actAs(db, admin);
    expect(await count("select user_id from public.bank_details where user_id = $1", [memberTwoStepId])).toBe(1);
    expect(
      await count("update public.bank_details set account_number = '9999999999' where user_id = $1", [memberTwoStepId]),
    ).toBe(0);
    expect(await count("delete from public.bank_details where user_id = $1", [memberTwoStepId])).toBe(0);
    expect(
      await outcome(
        db,
        `insert into public.bank_details (user_id, bank_name, branch, account_holder, account_number)
         values ($1, 'Other Bank', 'Galle', 'Someone', '5555555555')`,
        [memberId],
      ),
    ).toBe("42501");
    await asOwner(db);
    expect(
      (await rows("select account_number from public.bank_details where user_id = $1", [memberTwoStepId]))[0]
        .account_number,
    ).toBe("1234567890");
  });

  test("a main admin can still correct a member's bank details", async () => {
    await actAs(db, main);
    expect(
      await count("update public.bank_details set branch = 'Kandy City' where user_id = $1", [memberTwoStepId]),
    ).toBe(1);
  });
});

describe("phone notifications follow the login session", () => {
  /** A login session for this person, and act as them inside it. */
  const signIn = async (userId: string) => {
    await asOwner(db);
    const session = (await rows("insert into auth.sessions (user_id) values ($1) returning id", [userId]))[0]
      .id as string;
    await db.query("reset role");
    await db.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: userId, role: "authenticated", aal: "aal1", session_id: session }),
    ]);
    await db.query("set role authenticated");
    return session;
  };
  const save = (endpoint: string) =>
    db.query("select public.push_subscription_save($1, 'key', 'auth', 'Test phone')", [endpoint]);
  const live = async (userId: string) => {
    await asOwner(db);
    return (await rows("select endpoint from public.live_push_subscriptions($1)", [userId])).map((r) => r.endpoint);
  };

  test("a phone gets alerts only while its login session is alive", async () => {
    const endpoint = "https://push.example.test/a1";
    const session = await signIn(memberId);
    await save(endpoint);
    expect(await live(memberId)).toEqual([endpoint]);
    // Signing out ends the session: nothing more is sent to that phone.
    await asOwner(db);
    await db.query("delete from auth.sessions where id = $1", [session]);
    expect(await live(memberId)).toEqual([]);
  });

  test("the next person who turns alerts on takes the phone over", async () => {
    const endpoint = "https://push.example.test/shared";
    await signIn(memberId);
    await save(endpoint);
    await signIn(memberTwoStepId);
    await save(endpoint);
    expect(await live(memberId)).toEqual([]);
    expect(await live(memberTwoStepId)).toEqual([endpoint]);
  });

  test("members can't add a phone without a session, nor see another person's phones", async () => {
    await actAs(db, as(memberId, "aal1")); // no session_id in the token
    expect(await outcome(db, "select public.push_subscription_save('https://push.example.test/x', 'k', 'a', '')")).toBe(
      "42501",
    );
    expect(
      await outcome(
        db,
        "insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example.test/y', 'k', 'a')",
        [memberId],
      ),
    ).toBe("42501");
    expect(await count("select * from public.live_push_subscriptions($1)", [memberTwoStepId])).toBe(0);
  });

  test("refreshing links a phone to the new session only for its owner", async () => {
    const endpoint = "https://push.example.test/refresh";
    await signIn(memberId);
    await save(endpoint);
    const second = await signIn(memberId);
    expect((await rows("select public.push_subscription_refresh($1) as ok", [endpoint]))[0].ok).toBe(true);
    await signIn(memberTwoStepId);
    expect((await rows("select public.push_subscription_refresh($1) as ok", [endpoint]))[0].ok).toBe(false);
    await asOwner(db);
    expect(
      (await rows("select session_id from public.push_subscriptions where endpoint = $1", [endpoint]))[0].session_id,
    ).toBe(second);
  });
});
