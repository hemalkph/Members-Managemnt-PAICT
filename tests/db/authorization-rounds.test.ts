// Phase 2 functions called directly by every kind of account. Denials raise
// 42501 and change nothing (each call is rolled back).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, createBatch, createPerson, outcome, session, type Actor } from "./helpers";
import { planRound, seedStudents, trackingFile } from "./dispatch-fixtures";

type Name = "anon" | "viewOnly" | "editNoCap" | "planner" | "courier" | "packer" | "admin" | "main";
const ALL: Name[] = ["anon", "viewOnly", "editNoCap", "planner", "courier", "packer", "admin", "main"];
const PLAN: Name[] = ["planner", "admin", "main"];
const COURIER: Name[] = ["courier", "admin", "main"];

let db: pg.Client;
const actors = {} as Record<Name, Actor>;
let batch = "";
let draft = "";
let draftTutes: string[] = [];
let draftStudents: string[] = [];
let finalised = "";
let file = "";
let parcel = { id: "", row_version: 1 };

beforeAll(async () => {
  db = await session();
  const edit = { dispatch: "edit" as const };
  const user = async (opts: Parameters<typeof createPerson>[1], aal: "aal1" | "aal2" = "aal2"): Promise<Actor> => ({
    kind: "user",
    id: await createPerson(db, opts),
    aal,
  });
  actors.anon = { kind: "anon" };
  actors.viewOnly = await user({ pageAccess: { dispatch: "view" }, grants: ["plan", "courier"] });
  actors.editNoCap = await user({ pageAccess: edit });
  actors.planner = await user({ pageAccess: edit, grants: ["plan"] });
  actors.courier = await user({ pageAccess: edit, grants: ["courier"] });
  actors.packer = await user({ pageAccess: edit, grants: ["pack"] });
  actors.admin = await user({ admin: true }, "aal1");
  actors.main = await user({ mainAdmin: true });

  batch = await createBatch(db);
  draftStudents = await seedStudents(db, batch, ["A01", "A02"]);
  const d = await planRound(db, actors.main, batch, "AUTHDRAFT", draftStudents);
  draft = d.round;
  draftTutes = d.tutes;

  const fin = await seedStudents(db, batch, ["B01"]);
  finalised = (await planRound(db, actors.main, batch, "AUTHFINAL", fin)).round;
  await actAs(db, actors.main);
  await db.query("select public.round_finalise($1)", [finalised]);
  file = await trackingFile(db, actors.main, finalised);
  parcel = (await db.query("select id, row_version from public.parcels where round_id = $1", [finalised])).rows[0];
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

const OPERATIONS: { name: string; allowed: Name[]; run: (a: Actor) => Promise<string> }[] = [
  {
    name: "round_save (new)",
    allowed: PLAN,
    run: (a) =>
      attempt(a, "select public.round_save($1::jsonb)", [
        JSON.stringify({ name: "New round", batch_id: batch, sending_month: "2026-12-01", ref_prefix: "NEWPFX" }),
      ]),
  },
  {
    name: "round_set_tutes",
    allowed: PLAN,
    run: (a) =>
      attempt(a, "select public.round_set_tutes($1, $2::jsonb)", [draft, JSON.stringify([{ manual_title: "Tute X", short_code: "TX" }])]),
  },
  {
    name: "round_set_students",
    allowed: PLAN,
    run: (a) =>
      attempt(a, "select public.round_set_students($1, $2::jsonb)", [
        draft,
        JSON.stringify(draftStudents.map((s) => ({ student_id: s }))),
      ]),
  },
  { name: "round_cancel", allowed: PLAN, run: (a) => attempt(a, "select public.round_cancel($1, 'test')", [draft]) },
  { name: "round_finalise", allowed: PLAN, run: (a) => attempt(a, "select public.round_finalise($1)", [draft]) },
  {
    name: "parcel_correct",
    allowed: PLAN,
    run: (a) =>
      attempt(a, "select public.parcel_correct($1, $2::jsonb, 'test reason', $3)", [
        parcel.id,
        JSON.stringify({ cod_expected: 100 }),
        parcel.row_version,
      ]),
  },
  {
    name: "carrier_file_record (tracking sheet)",
    allowed: COURIER,
    run: (a) =>
      attempt(a, "select public.carrier_file_record($1, 'tracking_sheet', $2, 'x.xlsx', repeat('1', 64), 10, 1, '{}'::jsonb)", [
        finalised,
        `rounds/${finalised}/${crypto.randomUUID()}.xlsx`,
      ]),
  },
  {
    name: "tracking_apply",
    allowed: COURIER,
    run: (a) =>
      attempt(a, "select public.tracking_apply($1, $2, $3::jsonb)", [
        finalised,
        file,
        JSON.stringify([{ reference: "AUTHFINALB01", tracking_no: "D70000001" }]),
      ]),
  },
  {
    name: "carrier_file_record (Citypak template)",
    allowed: ["main"],
    run: (a) =>
      attempt(a, "select public.carrier_file_record(null, 'citypak_template', $1, 't.xlsx', repeat('2', 64), 10, 1, '{}'::jsonb)", [
        `templates/${crypto.randomUUID()}.xlsx`,
      ]),
  },
  { name: "citypak_template_set", allowed: ["main"], run: (a) => attempt(a, "select public.citypak_template_set(null, false)") },
  {
    name: "direct insert into parcels",
    allowed: [],
    run: (a) =>
      attempt(
        a,
        "insert into public.parcels (round_id, student_id, reference, cod_expected, weight_g, pieces) values ($1, $2, 'DIRECT1', 0, 1, 1)",
        [finalised, draftStudents[0]],
      ),
  },
  {
    name: "direct update of parcels",
    allowed: [],
    run: (a) => attempt(a, "update public.parcels set tracking_no = 'D11111111' where id = $1", [parcel.id]),
  },
  {
    name: "direct delete from round_tutes",
    allowed: [],
    run: (a) => attempt(a, "delete from public.round_tutes where id = $1", [draftTutes[0]]),
  },
  {
    name: "direct insert into parcel_events",
    allowed: [],
    run: (a) =>
      attempt(a, "insert into public.parcel_events (parcel_id, round_id, type, source) values ($1, $2, 'fake', 'manual')", [
        parcel.id,
        finalised,
      ]),
  },
];

describe.each(OPERATIONS)("$name", ({ allowed, run }) => {
  test.each(ALL)("%s", async (name) => {
    expect(await run(actors[name])).toBe(allowed.includes(name) ? "ok" : "42501");
  });
});
