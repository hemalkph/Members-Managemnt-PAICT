// Money, closing and report functions called by every kind of account (rolled back).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";
import { deliveredRound, settle } from "./dispatch-fixtures";

type Name = "anon" | "viewOnly" | "editNoCap" | "planner" | "courier" | "finance" | "admin" | "main";
const ALL: Name[] = ["anon", "viewOnly", "editNoCap", "planner", "courier", "finance", "admin", "main"];

let db: pg.Client;
const actors = {} as Record<Name, Actor>;
let round = "";
let settledRound = "";
let parcelId = "";
let draft = "";
let confirmed = "";

beforeAll(async () => {
  db = await session();
  const edit = { dispatch: "edit" as const };
  const user = async (opts: Parameters<typeof createPerson>[1], aal: "aal1" | "aal2" = "aal2"): Promise<Actor> => ({
    kind: "user",
    id: await createPerson(db, opts),
    aal,
  });
  actors.anon = { kind: "anon" };
  actors.viewOnly = await user({ pageAccess: { dispatch: "view" }, grants: ["finance", "plan"] });
  actors.editNoCap = await user({ pageAccess: edit });
  actors.planner = await user({ pageAccess: edit, grants: ["plan"] });
  actors.courier = await user({ pageAccess: edit, grants: ["courier"] });
  actors.finance = await user({ pageAccess: edit, grants: ["finance"] });
  actors.admin = await user({ admin: true }, "aal1");
  actors.main = await user({ mainAdmin: true });
  const verifier = await user({ pageAccess: edit, grants: ["verify"] });

  const batch = await createBatch(db);
  const r = await deliveredRound(db, actors.main, verifier, batch, "AUTHMON", 2);
  round = r.round;
  parcelId = r.parcels[0].id;
  confirmed = await settle(db, actors.main, `AUTH-${Date.now()}`, [{ code: r.parcels[1].tracking }], 500);
  await actAs(db, actors.main);
  draft = (await db.query("select public.settlement_save(null, $1::jsonb) as id", [JSON.stringify({ reference: `AUTHD-${Date.now()}`, settled_on: "2026-11-20", remitted: 500 })])).rows[0].id;
  // A second round ready to close.
  const s = await deliveredRound(db, actors.main, verifier, batch, "AUTHCLS", 1);
  settledRound = s.round;
  await settle(db, actors.main, `AUTHC-${Date.now()}`, [{ code: s.parcels[0].tracking }], 500);
  await asOwner(db);
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

const FINANCE: Name[] = ["finance", "main"];
const OPERATIONS: { name: string; allowed: Name[]; run: (a: Actor) => Promise<string> }[] = [
  { name: "settlement_save", allowed: FINANCE, run: (a) => attempt(a, "select public.settlement_save(null, $1::jsonb)", [JSON.stringify({ reference: "X-1", settled_on: "2026-11-01", remitted: 1 })]) },
  { name: "settlement_add_lines", allowed: FINANCE, run: (a) => attempt(a, "select public.settlement_add_lines($1, '[]'::jsonb)", [draft]) },
  { name: "settlement_cancel (draft)", allowed: FINANCE, run: (a) => attempt(a, "select public.settlement_cancel($1, 'test')", [draft]) },
  { name: "settlement_cancel (confirmed)", allowed: ["main"], run: (a) => attempt(a, "select public.settlement_cancel($1, 'test reason')", [confirmed]) },
  { name: "cod_writeoff_set", allowed: FINANCE, run: (a) => attempt(a, "select public.cod_writeoff_set($1, 10, 'test reason')", [parcelId]) },
  { name: "round_close", allowed: ["planner", "admin", "main"], run: (a) => attempt(a, "select public.round_close($1, '')", [settledRound]) },
  { name: "round_close_check", allowed: ["viewOnly", "editNoCap", "planner", "courier", "finance", "admin", "main"], run: (a) => attempt(a, "select public.round_close_check($1)", [round]) },
  { name: "dispatch_report_rounds", allowed: ["planner", "courier", "finance", "admin", "main"], run: (a) => attempt(a, "select * from public.dispatch_report_rounds('2026-01-01', '2026-12-01')") },
  { name: "dispatch_report_people", allowed: ["planner", "finance", "admin", "main"], run: (a) => attempt(a, "select * from public.dispatch_report_people('2026-01-01', '2026-12-01')") },
  { name: "direct insert into cod_settlement_lines", allowed: [], run: (a) => attempt(a, "insert into public.cod_settlement_lines (settlement_id, parcel_id, collected) values ($1, $2, 1)", [draft, parcelId]) },
  { name: "direct update of cod_settlements", allowed: [], run: (a) => attempt(a, "update public.cod_settlements set state = 'confirmed' where id = $1", [draft]) },
];

describe.each(OPERATIONS)("$name", ({ allowed, run }) => {
  test.each(ALL)("%s", async (name) => {
    expect(await run(actors[name])).toBe(allowed.includes(name) ? "ok" : "42501");
  });
});

test("only finance sees settlements and parcel money", async () => {
  for (const name of ALL.filter((n) => n !== "anon")) {
    await db.query("begin");
    await actAs(db, actors[name]);
    const settlements = (await db.query("select count(*)::int as n from public.cod_settlements")).rows[0].n;
    const listed = (await db.query("select count(*)::int as n from public.dispatch_settlements()")).rows[0].n;
    const rows = (await db.query("select count(*)::int as n from public.dispatch_cod_rows($1)", [round])).rows[0].n;
    await db.query("rollback");
    const fin = FINANCE.includes(name);
    expect([settlements > 0, listed > 0, rows > 0], name).toEqual([fin, fin, fin]);
  }
});

test("only a main admin can reopen a round", async () => {
  await db.query("begin");
  await actAs(db, actors.main);
  await db.query("select public.round_close($1, '')", [settledRound]);
  for (const name of ALL) {
    await db.query("savepoint s");
    await actAs(db, actors[name]);
    const r = await outcome(db, "select public.round_reopen($1, 'test reason')", [settledRound]);
    await db.query("rollback to savepoint s");
    expect(r, name).toBe(name === "main" ? "ok" : "42501");
  }
  await db.query("rollback");
});
