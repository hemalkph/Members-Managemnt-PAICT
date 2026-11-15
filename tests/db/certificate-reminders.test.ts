// GN certificate reminders: once at 30 days left, once when it runs out,
// only to admins who can open Concession students, never twice.
import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";
import { asOwner, createBatch, createPerson, session } from "./helpers";

let db: pg.Client;
let admin = "";
let blocked = "";
let member = "";
let batch = "";
const stamp = Date.now();

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
// A student whose certificate is valid for `validUntilOffset` more days (negative = ran out that many days ago).
const addStudent = async (no: string, status: string, validUntilOffset: number) => {
  const [{ id }] = await q(
    "insert into public.concession_students (student_no, full_name, batch_id, card_type, status) values ($1, $2, $3, 'free', $4) returning id",
    [no, `Student ${no}`, batch, status],
  );
  await q(
    `insert into public.concession_student_private (student_id, certificate_issued_on)
     values ($1, ((now() at time zone 'Asia/Colombo')::date + $2::integer - interval '12 months')::date)`,
    [id, validUntilOffset],
  );
  return id as string;
};
const notes = (user: string, kind: string) =>
  q("select title, link from public.notifications where user_id = $1 and kind = $2 order by title", [user, kind]);

beforeAll(async () => {
  db = await session();
  admin = await createPerson(db, { admin: true });
  blocked = await createPerson(db, { admin: true, pageAccess: { students: "none" } });
  member = await createPerson(db);
  batch = await createBatch(db);
});
afterAll(() => db.end());

test("reminds once before expiry and once after, only admins with the page", async () => {
  await asOwner(db);
  const soon = await addStudent(`S${stamp}`, "verified", 20); // 20 days left
  await addStudent(`L${stamp}`, "verified", 60); // too early
  const expired = await addStudent(`X${stamp}`, "under_review", -3); // ran out 3 days ago
  await addStudent(`O${stamp}`, "verified", -40); // long gone: flag only, no notification
  await addStudent(`E${stamp}`, "ended", 10); // ended students are left alone

  await q("select public.send_certificate_reminders()");
  await q("select public.send_certificate_reminders()"); // the next day: nothing new

  expect(await notes(admin, "student.certificate")).toEqual([
    { title: `GN certificate expires soon: Student S${stamp}`, link: `/admin/students/${soon}` },
  ]);
  expect(await notes(admin, "student.certificate_expired")).toEqual([
    { title: `GN certificate expired: Student X${stamp}`, link: `/admin/students/${expired}` },
  ]);
  expect(await q("select 1 from public.notifications where user_id = any($1) and kind like 'student.certificate%'", [[blocked, member]])).toHaveLength(0);
});

test("a new certificate date starts the reminders again", async () => {
  await asOwner(db);
  const id = await addStudent(`R${stamp}`, "verified", 5);
  await q("select public.send_certificate_reminders()");
  await q(
    "update public.concession_student_private set certificate_issued_on = certificate_issued_on + 1 where student_id = $1",
    [id],
  );
  await q("select public.send_certificate_reminders()");
  expect(await q("select 1 from public.notifications where user_id = $1 and link = $2", [admin, `/admin/students/${id}`])).toHaveLength(2);
});

test("people can't run it", async () => {
  await asOwner(db);
  const [{ ok }] = await q("select has_function_privilege('authenticated', 'public.send_certificate_reminders()', 'execute') as ok");
  expect(ok).toBe(false);
});
