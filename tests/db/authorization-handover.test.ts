// Handover, delivery and replacement functions called by every kind of account (rolled back).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";
import { handOver, verifiedRound, type ReadyParcel } from "./dispatch-fixtures";

type Name = "anon" | "viewOnly" | "editNoCap" | "packer" | "verifier" | "courier" | "admin" | "main";
const ALL: Name[] = ["anon", "viewOnly", "editNoCap", "packer", "verifier", "courier", "admin", "main"];

let db: pg.Client;
const actors = {} as Record<Name, Actor>;
let round = "";
let parcels: ReadyParcel[] = [];
let openHandover = "";
let sheetFile = "";
let receiptFile = "";

beforeAll(async () => {
  db = await session();
  const edit = { dispatch: "edit" as const };
  const user = async (opts: Parameters<typeof createPerson>[1], aal: "aal1" | "aal2" = "aal2"): Promise<Actor> => ({
    kind: "user",
    id: await createPerson(db, opts),
    aal,
  });
  actors.anon = { kind: "anon" };
  actors.viewOnly = await user({ pageAccess: { dispatch: "view" }, grants: ["verify", "courier", "correct"] });
  actors.editNoCap = await user({ pageAccess: edit });
  actors.packer = await user({ pageAccess: edit, grants: ["pack"] });
  actors.verifier = await user({ pageAccess: edit, grants: ["verify"] });
  actors.courier = await user({ pageAccess: edit, grants: ["courier"] });
  actors.admin = await user({ admin: true }, "aal1");
  actors.main = await user({ mainAdmin: true });

  const batch = await createBatch(db);
  // parcels[0] handed over, [1] in the open handover, [2] ready.
  ({ round, parcels } = await verifiedRound(db, actors.main, actors.verifier, batch, "AUTHHND", 3));
  await handOver(db, actors.main, round, [parcels[0]]);
  await actAs(db, actors.main);
  openHandover = (await db.query("select public.handover_open($1) as id", [round])).rows[0].id;
  await db.query("select public.handover_scan($1, $2)", [openHandover, parcels[1].tracking]);
  receiptFile = (
    await db.query("select public.carrier_file_record($1, 'handover_receipt', $2, 'r.png', repeat('c', 64), 10, null, '{}'::jsonb) as id", [
      round,
      `receipts/${round}/${crypto.randomUUID()}.png`,
    ])
  ).rows[0].id;
  await asOwner(db);
  sheetFile = (await db.query("select id from public.carrier_files where round_id = $1 and kind = 'tracking_sheet' limit 1", [round])).rows[0].id;
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

const VERIFIERS: Name[] = ["verifier", "admin", "main"];
const COURIER: Name[] = ["courier", "admin", "main"];
const OPERATIONS: { name: string; allowed: Name[]; run: (a: Actor) => Promise<string> }[] = [
  { name: "handover_open", allowed: VERIFIERS, run: (a) => attempt(a, "select public.handover_open($1)", [round]) },
  { name: "handover_scan", allowed: VERIFIERS, run: (a) => attempt(a, "select public.handover_scan($1, $2)", [openHandover, parcels[2].tracking]) },
  { name: "handover_release", allowed: VERIFIERS, run: (a) => attempt(a, "select public.handover_release($1, $2)", [openHandover, parcels[1].id]) },
  { name: "handover_confirm", allowed: VERIFIERS, run: (a) => attempt(a, "select public.handover_confirm($1, 1, '', '', '')", [openHandover]) },
  { name: "handover_cancel", allowed: VERIFIERS, run: (a) => attempt(a, "select public.handover_cancel($1, 'test')", [openHandover]) },
  {
    name: "handover receipt file",
    allowed: ["verifier", "courier", "admin", "main"],
    run: (a) =>
      attempt(a, "select public.carrier_file_record($1, 'handover_receipt', $2, 'r.jpg', repeat('b', 64), 10, null, '{}'::jsonb)", [
        round,
        `receipts/${round}/${crypto.randomUUID()}.jpg`,
      ]),
  },
  {
    name: "dispatch_handover_list",
    allowed: ["viewOnly", "editNoCap", "packer", "verifier", "courier", "admin", "main"],
    run: (a) => attempt(a, "select * from public.dispatch_handover_list($1)", [round]),
  },
  { name: "delivery_set", allowed: COURIER, run: (a) => attempt(a, "select public.delivery_set($1::uuid[], 'in_transit', '')", [[parcels[0].id]]) },
  { name: "parcel_void", allowed: ["main"], run: (a) => attempt(a, "select public.parcel_void($1, 'test reason')", [parcels[2].id]) },
  { name: "parcel_replace", allowed: ["main"], run: (a) => attempt(a, "select public.parcel_replace($1, 'test reason', '{}'::jsonb)", [parcels[2].id]) },
  { name: "download a Citypak sheet", allowed: COURIER, run: (a) => attempt(a, "select public.dispatch_log_download($1)", [sheetFile]) },
  {
    name: "download a handover receipt",
    allowed: ["verifier", "courier", "admin", "main"],
    run: (a) => attempt(a, "select public.dispatch_log_download($1)", [receiptFile]),
  },
  {
    name: "direct update of parcels.delivery_state",
    allowed: [],
    run: (a) => attempt(a, "update public.parcels set delivery_state = 'delivered' where id = $1", [parcels[0].id]),
  },
  {
    name: "direct insert into handover_parcels",
    allowed: [],
    run: (a) => attempt(a, "insert into public.handover_parcels (handover_id, parcel_id) values ($1, $2)", [openHandover, parcels[2].id]),
  },
];

describe.each(OPERATIONS)("$name", ({ allowed, run }) => {
  test.each(ALL)("%s", async (name) => {
    expect(await run(actors[name])).toBe(allowed.includes(name) ? "ok" : "42501");
  });
});

test("handovers are readable with page access only", async () => {
  for (const name of ALL) {
    await db.query("begin");
    await actAs(db, actors[name]);
    const n = await db
      .query("select count(*)::int as n from public.handovers where round_id = $1", [round])
      .then((r) => r.rows[0].n as number)
      .catch(() => -1);
    await db.query("rollback");
    expect(n > 0, name).toBe(name !== "anon");
  }
});

test("a receipt must be stored in the receipts folder", async () => {
  expect(
    await attempt(
      actors.verifier,
      "select public.carrier_file_record($1, 'handover_receipt', $2, 'r.jpg', repeat('d', 64), 10, null, '{}'::jsonb)",
      [round, `rounds/${round}/${crypto.randomUUID()}.jpg`],
    ),
  ).toBe("P0001");
});
