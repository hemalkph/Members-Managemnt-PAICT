// Packing functions called directly by every kind of account (rolled back).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";
import { readyRound, type ReadyParcel } from "./dispatch-fixtures";

type Name = "anon" | "viewOnly" | "editNoCap" | "packer" | "verifier" | "planner" | "admin" | "main";
const ALL: Name[] = ["anon", "viewOnly", "editNoCap", "packer", "verifier", "planner", "admin", "main"];

let db: pg.Client;
const actors = {} as Record<Name, Actor>;
let round = "";
let parcels: ReadyParcel[] = [];
let exceptionId = "";

beforeAll(async () => {
  db = await session();
  const edit = { dispatch: "edit" as const };
  const user = async (opts: Parameters<typeof createPerson>[1], aal: "aal1" | "aal2" = "aal2"): Promise<Actor> => ({
    kind: "user",
    id: await createPerson(db, opts),
    aal,
  });
  actors.anon = { kind: "anon" };
  actors.viewOnly = await user({ pageAccess: { dispatch: "view" }, grants: ["pack", "plan"] });
  actors.editNoCap = await user({ pageAccess: edit });
  actors.packer = await user({ pageAccess: edit, grants: ["pack"] });
  actors.verifier = await user({ pageAccess: edit, grants: ["verify"] });
  actors.planner = await user({ pageAccess: edit, grants: ["plan"] });
  actors.admin = await user({ admin: true }, "aal1");
  actors.main = await user({ mainAdmin: true });

  const batch = await createBatch(db);
  ({ round, parcels } = await readyRound(db, actors.main, batch, "AUTHPACK", 3));
  // parcels[1] packed by main; parcels[2] has an open problem.
  await actAs(db, actors.main);
  await db.query("select public.parcel_scan_confirm($1, 'pack', gen_random_uuid(), $2, $3::uuid[])", [
    parcels[1].id,
    parcels[1].row_version,
    parcels[1].items,
  ]);
  exceptionId = (await db.query("select public.exception_open($1, 'damaged', 'test') as id", [parcels[2].id])).rows[0].id;
  await asOwner(db);
  parcels[1].row_version = (await db.query("select row_version from public.parcels where id = $1", [parcels[1].id])).rows[0].row_version;
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

const PACKERS: Name[] = ["packer", "admin", "main"];
const OPERATIONS: { name: string; allowed: Name[]; run: (a: Actor) => Promise<string> }[] = [
  { name: "scan_lookup (pack)", allowed: PACKERS, run: (a) => attempt(a, "select public.scan_lookup($1, $2, 'pack')", [round, parcels[0].tracking]) },
  {
    name: "scan_lookup (verify)",
    allowed: ["verifier", "admin", "main"],
    run: (a) => attempt(a, "select public.scan_lookup($1, $2, 'verify')", [round, parcels[1].tracking]),
  },
  {
    name: "parcel_scan_confirm (pack)",
    allowed: PACKERS,
    run: (a) =>
      attempt(a, "select public.parcel_scan_confirm($1, 'pack', gen_random_uuid(), $2, $3::uuid[])", [
        parcels[0].id,
        parcels[0].row_version,
        parcels[0].items,
      ]),
  },
  {
    name: "parcel_scan_confirm (verify)",
    allowed: ["verifier", "admin", "main"],
    run: (a) =>
      attempt(a, "select public.parcel_scan_confirm($1, 'verify', gen_random_uuid(), $2, $3::uuid[])", [
        parcels[1].id,
        parcels[1].row_version,
        parcels[1].items,
      ]),
  },
  {
    name: "parcel_unpack",
    allowed: ["main"],
    run: (a) => attempt(a, "select public.parcel_unpack($1, 'test reason', $2)", [parcels[1].id, parcels[1].row_version]),
  },
  {
    name: "exception_open",
    allowed: ["packer", "verifier", "planner", "admin", "main"],
    run: (a) => attempt(a, "select public.exception_open($1, 'other', 'test')", [parcels[0].id]),
  },
  {
    name: "exception_resolve",
    allowed: ["planner", "admin", "main"],
    run: (a) => attempt(a, "select public.exception_resolve($1, 'fixed', 'ok')", [exceptionId]),
  },
  {
    name: "parcel_assign",
    allowed: ["planner", "admin", "main"],
    run: (a) => attempt(a, "select public.parcel_assign($1, $2::uuid[], null)", [round, [parcels[0].id]]),
  },
  {
    name: "dispatch_pack_list",
    allowed: ["packer", "verifier", "planner", "admin", "main"],
    run: (a) => attempt(a, "select * from public.dispatch_pack_list($1)", [round]),
  },
  {
    name: "direct insert into parcel_scans",
    allowed: [],
    run: (a) => attempt(a, "insert into public.parcel_scans (round_id, action, result) values ($1, 'pack', 'ok')", [round]),
  },
  {
    name: "direct update of parcel_exceptions",
    allowed: [],
    run: (a) => attempt(a, "update public.parcel_exceptions set resolved_at = now(), resolution = 'fixed' where id = $1", [exceptionId]),
  },
];

describe.each(OPERATIONS)("$name", ({ allowed, run }) => {
  test.each(ALL)("%s", async (name) => {
    expect(await run(actors[name])).toBe(allowed.includes(name) ? "ok" : "42501");
  });
});

test("only planners get the list of packers", async () => {
  for (const name of ALL.filter((n) => n !== "anon")) {
    await db.query("begin");
    await actAs(db, actors[name]);
    const { rows } = await db.query("select count(*)::int as n from public.dispatch_packers()");
    await db.query("rollback");
    expect(rows[0].n > 0, name).toBe(["planner", "admin", "main"].includes(name));
  }
});
