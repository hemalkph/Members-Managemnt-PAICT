// Calls every Phase 1 dispatch function directly, as each kind of account,
// the way a hand-made API request would. Denials must raise 42501 and change
// nothing (each call runs in a transaction that is rolled back).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";

type Name =
  | "anon"
  | "inactive"
  | "noPage"
  | "viewOnly"
  | "editNoCap"
  | "capNoTwoStep"
  | "planner"
  | "adminNoPage"
  | "admin"
  | "mainNoTwoStep"
  | "main";

let db: pg.Client;
const actors = {} as Record<Name, Actor>;
let batch = "";
let studentId = "";
let importId = "";

beforeAll(async () => {
  db = await session();
  const dispatchEdit = { dispatch: "edit" as const };
  const person = async (opts: Parameters<typeof createPerson>[1], aal: "aal1" | "aal2"): Promise<Actor> => ({
    kind: "user",
    id: await createPerson(db, opts),
    aal,
  });
  actors.anon = { kind: "anon" };
  actors.inactive = await person({ active: false, pageAccess: dispatchEdit, grants: ["plan"] }, "aal2");
  actors.noPage = await person({ grants: ["plan"] }, "aal2");
  actors.viewOnly = await person({ pageAccess: { dispatch: "view" }, grants: ["plan"] }, "aal2");
  actors.editNoCap = await person({ pageAccess: dispatchEdit }, "aal2");
  actors.capNoTwoStep = await person({ pageAccess: dispatchEdit, grants: ["plan"] }, "aal1");
  actors.planner = await person({ pageAccess: dispatchEdit, grants: ["plan"] }, "aal2");
  actors.adminNoPage = await person({ admin: true, pageAccess: { dispatch: "none" } }, "aal1");
  actors.admin = await person({ admin: true }, "aal1");
  actors.mainNoTwoStep = await person({ mainAdmin: true }, "aal1");
  actors.main = await person({ mainAdmin: true }, "aal2");

  batch = await createBatch(db);
  await asOwner(db);
  studentId = (
    await db.query(
      "insert into public.students (batch_id, student_no, full_name) values ($1, '088', 'Synthetic Student') returning id",
      [batch],
    )
  ).rows[0].id;
  importId = (
    await db.query(
      `insert into public.student_imports (batch_id, file_name, sha256, size_bytes, row_count)
       values ($1, 'synthetic.xlsx', repeat('a', 64), 100, 1) returning id`,
      [batch],
    )
  ).rows[0].id;
});
afterAll(() => db.end());

async function attempt(actor: Actor, sql: string, params: unknown[] = []) {
  await db.query("begin");
  try {
    await actAs(db, actor);
    return await outcome(db, sql, params);
  } finally {
    await db.query("rollback");
  }
}

const ALL = Object.keys({
  anon: 0, inactive: 0, noPage: 0, viewOnly: 0, editNoCap: 0, capNoTwoStep: 0,
  planner: 0, adminNoPage: 0, admin: 0, mainNoTwoStep: 0, main: 0,
}) as Name[];
const PLANNERS: Name[] = ["planner", "admin", "mainNoTwoStep", "main"];
const MAIN_ONLY: Name[] = ["main"];

const OPERATIONS: { name: string; allowed: Name[]; run: (a: Actor) => Promise<string> }[] = [
  {
    name: "student_save (add)",
    allowed: PLANNERS,
    run: (a) =>
      attempt(a, "select public.student_save($1::jsonb)", [
        JSON.stringify({ batch_id: batch, student_no: "777", full_name: "New Synthetic" }),
      ]),
  },
  {
    name: "student_set_active",
    allowed: PLANNERS,
    run: (a) => attempt(a, "select public.student_set_active($1, false)", [studentId]),
  },
  {
    name: "student_import_start",
    allowed: PLANNERS,
    run: (a) =>
      attempt(a, "select public.student_import_start($1, 'x.xlsx', null, repeat('b', 64), 10, 1)", [batch]),
  },
  {
    name: "students_import_apply",
    allowed: PLANNERS,
    run: (a) =>
      attempt(a, "select public.students_import_apply($1, $2::jsonb)", [
        importId,
        JSON.stringify([{ action: "new", student_no: "555", full_name: "Imported Synthetic" }]),
      ]),
  },
  {
    name: "dispatch_settings_save (sender)",
    allowed: PLANNERS,
    run: (a) => attempt(a, "select public.dispatch_settings_save($1::jsonb)", [JSON.stringify({ sender_name: "PAICT" })]),
  },
  {
    name: "dispatch_settings_save (retention)",
    allowed: MAIN_ONLY,
    run: (a) =>
      attempt(a, "select public.dispatch_settings_save($1::jsonb)", [JSON.stringify({ import_file_retention_days: 31 })]),
  },
  {
    name: "dispatch_grant",
    allowed: MAIN_ONLY,
    run: (a) => attempt(a, "select public.dispatch_grant($1, 'pack', 'test')", [(actors.editNoCap as { id: string }).id]),
  },
  {
    name: "dispatch_revoke",
    allowed: MAIN_ONLY,
    run: (a) => attempt(a, "select public.dispatch_revoke($1, 'plan', 'test')", [(actors.planner as { id: string }).id]),
  },
  {
    name: "direct insert into students",
    allowed: [],
    run: (a) =>
      attempt(a, "insert into public.students (batch_id, student_no, full_name) values ($1, '999', 'Direct')", [batch]),
  },
  {
    name: "direct update of students",
    allowed: [],
    run: (a) => attempt(a, "update public.students set full_name = 'Changed' where id = $1", [studentId]),
  },
  {
    name: "direct delete from student_imports",
    allowed: [],
    run: (a) => attempt(a, "delete from public.student_imports where id = $1", [importId]),
  },
  {
    name: "direct insert into dispatch_grants",
    allowed: [],
    run: (a) =>
      attempt(a, "insert into public.dispatch_grants (user_id, capability) values ($1, 'finance')", [
        (actors.editNoCap as { id: string }).id,
      ]),
  },
];

describe.each(OPERATIONS)("$name", ({ allowed, run }) => {
  test.each(ALL)("%s", async (name) => {
    const result = await run(actors[name]);
    expect(result).toBe(allowed.includes(name) ? "ok" : "42501");
  });
});

describe("reading student data", () => {
  test.each(ALL)("%s", async (name) => {
    await db.query("begin");
    try {
      await actAs(db, actors[name]);
      if (name === "anon") {
        expect(await outcome(db, "select count(*) from public.students")).toBe("42501");
        return;
      }
      const { rows } = await db.query("select count(*)::int as n from public.students");
      expect(rows[0].n > 0).toBe(PLANNERS.includes(name));
    } finally {
      await db.query("rollback");
    }
  });
});

describe("capabilities", () => {
  test("admins get plan, courier, pack, verify; only a main admin with two-step gets correct and finance", async () => {
    const caps = async (name: Name) => {
      await db.query("begin");
      try {
        await actAs(db, actors[name]);
        return (await db.query("select public.dispatch_my_caps() as c")).rows[0].c;
      } finally {
        await db.query("rollback");
      }
    };
    expect(await caps("admin")).toEqual(["courier", "pack", "plan", "verify"]);
    expect(await caps("mainNoTwoStep")).toEqual(["courier", "pack", "plan", "verify"]);
    expect(await caps("main")).toEqual(["correct", "courier", "finance", "pack", "plan", "verify"]);
    expect(await caps("planner")).toEqual(["plan"]);
    expect(await caps("capNoTwoStep")).toEqual([]);
    expect(await caps("viewOnly")).toEqual([]);
    expect(await caps("adminNoPage")).toEqual([]);
  });
});
