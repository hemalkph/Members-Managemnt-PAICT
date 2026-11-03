// Citypak orders (slice 2): server-only saving, idempotent sync with history,
// duplicates, account isolation, read-only matching against dispatch parcels,
// and proof that no internal parcel, event or COD record changes.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { actAs, asOwner, createBatch, createPerson, outcome, session, type Actor } from "./helpers";
import { planRound, readyRound, seedStudents, type ReadyParcel } from "./dispatch-fixtures";
import { parseBulkUploadPage, toDbRows } from "@/lib/citypak/bulk-uploads";
import { orderDbRows, parseOrderPage } from "@/lib/citypak/orders";

let db: pg.Client;
let main: Actor;
let courierId = "";
let courier: Actor;
let planner: Actor;
let packer: Actor;
let viewer: Actor;
let batch = "";

beforeAll(async () => {
  db = await session();
  main = { kind: "user", id: await createPerson(db, { mainAdmin: true }), aal: "aal2" };
  courierId = await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["courier"] });
  courier = { kind: "user", id: courierId, aal: "aal2" };
  planner = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["plan"] }), aal: "aal2" };
  packer = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["pack"] }), aal: "aal2" };
  viewer = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "view" } }), aal: "aal2" };
  batch = await createBatch(db);
});
afterAll(() => db.end());

const asService = async () => {
  await asOwner(db);
  await db.query("set role service_role");
};
type Order = { external_id: number; tracking_no?: string | null; reference?: string; external_created_at?: string };
const order = (id: number, over: Partial<Order> = {}): Order => ({
  external_id: id,
  tracking_no: `D8${String(id).padStart(7, "0")}`,
  reference: `FXREF${id}`,
  external_created_at: "2026-10-30T09:00:00+05:30",
  ...over,
});
const sync = async (account: string, rows: Order[] | ReturnType<typeof orderDbRows>, opts: { rejected?: number; truncated?: boolean } = {}) => {
  await asService();
  return (
    await db.query("select public.citypak_sync_orders($1, $2, $3, $4::jsonb, 1, $5, $6) as r", [
      courierId,
      account,
      account === "fixture" ? "fixture" : "live",
      JSON.stringify(rows),
      opts.rejected ?? 0,
      opts.truncated ?? false,
    ])
  ).rows[0].r;
};
const matches = async (account: string) => {
  await asOwner(db);
  return Object.fromEntries(
    (
      await db.query(
        "select external_id, match_status, conflict_reason, parcel_id from public.citypak_order_matches where account = $1",
        [account],
      )
    ).rows.map((r) => [Number(r.external_id), { status: r.match_status, reason: r.conflict_reason, parcel: r.parcel_id }]),
  );
};

describe("saving orders", () => {
  test("only the server (service role) can save; signed-in users of every role are refused", async () => {
    for (const a of [courier, planner, packer, viewer]) {
      await actAs(db, a);
      expect(
        await outcome(db, "select public.citypak_sync_orders($1, 'main', 'live', $2::jsonb, 1, 0)", [
          (a as { id: string }).id,
          JSON.stringify([order(1)]),
        ]),
      ).toBe("42501");
    }
    await asOwner(db);
    expect((await db.query("select count(*)::int n from public.citypak_orders where account = 'main'")).rows[0].n).toBe(0);
  });

  test("new, then unchanged, then updated – with history only for new orders and changed identifiers", async () => {
    expect(await sync("acct_o", [order(10), order(11)])).toMatchObject({ outcome: "ok", new: 2, unchanged: 0 });
    expect(await sync("acct_o", [order(10), order(11)])).toMatchObject({ new: 0, updated: 0, unchanged: 2 });
    expect(await sync("acct_o", [order(10, { tracking_no: "D800000999" }), order(11)])).toMatchObject({ updated: 1, unchanged: 1 });
    await asOwner(db);
    const history = (
      await db.query(
        `select o.external_id, h.kind, h.tracking_no, h.prev_tracking_no from public.citypak_order_history h
           join public.citypak_orders o on o.id = h.order_id where o.account = 'acct_o' order by h.id`,
      )
    ).rows.map((r) => [Number(r.external_id), r.kind, r.tracking_no, r.prev_tracking_no]);
    expect(history).toEqual([
      [10, "first_seen", "D80000010", null],
      [11, "first_seen", "D80000011", null],
      [10, "changed", "D800000999", "D80000010"],
    ]);
    // History can't be edited or deleted, even by the owner.
    expect(await outcome(db, "update public.citypak_order_history set kind = 'changed'")).toBe("42501");
    expect(await outcome(db, "delete from public.citypak_order_history")).toBe("42501");
  });

  test("a repeated id in one sync is saved once (last wins); missing identifiers are kept as empty", async () => {
    expect(await sync("acct_dup", [order(20, { tracking_no: "D811111111" }), order(20, { tracking_no: "D822222222" }), order(21, { tracking_no: null, reference: "" })])).toMatchObject({ fetched: 2, new: 2 });
    await asOwner(db);
    const rows = (await db.query("select external_id, tracking_no, reference from public.citypak_orders where account = 'acct_dup' order by external_id")).rows;
    expect(rows).toEqual([
      { external_id: "20", tracking_no: "D822222222", reference: "FXREF20" },
      { external_id: "21", tracking_no: null, reference: "" },
    ]);
  });

  test("partial runs are 'partial'; failures are recorded under the orders stream", async () => {
    expect(await sync("acct_run", [order(30)], { truncated: true })).toMatchObject({ outcome: "partial" });
    await asService();
    await db.query("select public.citypak_record_failed_sync($1, 'acct_run', 'live', 'network', 2, 50, 'orders')", [courierId]);
    expect(await outcome(db, "select public.citypak_record_failed_sync($1, 'acct_run', 'live', 'network', 0, 0, 'cod')", [courierId])).toBe("P0001");
    await asOwner(db);
    expect((await db.query("select stream, outcome, error_class from public.citypak_sync_runs where account = 'acct_run' order by created_at, id")).rows).toEqual([
      { stream: "orders", outcome: "partial", error_class: null },
      { stream: "orders", outcome: "failed", error_class: "network" },
    ]);
  });

  test("accounts never mix, and the demo account can't be live", async () => {
    await sync("acct_x", [order(40, { reference: "XONLY" })]);
    await sync("acct_y", [order(40, { reference: "YONLY" })]);
    await asOwner(db);
    expect((await db.query("select account, reference from public.citypak_orders where external_id = 40 order by account")).rows).toEqual([
      { account: "acct_x", reference: "XONLY" },
      { account: "acct_y", reference: "YONLY" },
    ]);
    await asService();
    expect(await outcome(db, "select public.citypak_sync_orders($1, 'fixture', 'live', '[]'::jsonb, 0, 0)", [courierId])).toBe("P0001");
  });

  test("malformed identifiers are refused by the table", async () => {
    await expect(sync("acct_bad", [order(50, { tracking_no: "has space" })])).rejects.toMatchObject({ code: "23514" });
    await expect(sync("acct_bad", [order(51, { reference: "drop table;" })])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("audit regressions: saving", () => {
  const envelope = (rows: unknown[]) => ({ data: { current_page: 1, last_page: 1, per_page: 25, total: rows.length, data: rows } });

  test("H1: malformed ids are skipped and counted; the valid orders of the same sync are saved (partial)", async () => {
    const raw = [0, "0", "000", -1, 1.5, true, "9007199254740993", 9001, "9002"].map((id) => ({ id, tracking_number: null, reference: `IDCHK${String(id).replace(/\W/g, "")}` }));
    const page = parseOrderPage(envelope(raw));
    expect(page.rejected).toBe(7);
    expect(await sync("acct_ids", orderDbRows(page.rows), { rejected: page.rejected })).toMatchObject({ outcome: "partial", new: 2, rejected: 7 });
    await asOwner(db);
    expect((await db.query("select external_id from public.citypak_orders where account = 'acct_ids' order by 1")).rows.map((r) => Number(r.external_id))).toEqual([9001, 9002]);
  });

  test("H1 (slice 1): bulk uploads skip malformed ids the same way", async () => {
    const b = (id: unknown) => ({ id, tracking_number: `B-${String(id)}`, fileName: "f.xlsx", status: "SUCCESS", waybills: 1 });
    const page = parseBulkUploadPage(envelope([b(true), b("000"), b(0), b(8001)]));
    expect(page.rejected).toBe(3);
    await asService();
    const r = (
      await db.query("select public.citypak_sync_bulk_uploads($1, 'acct_ids', 'live', $2::jsonb, 1, $3, false) as r", [courierId, JSON.stringify(toDbRows(page.rows)), page.rejected])
    ).rows[0].r;
    expect(r).toMatchObject({ outcome: "partial", new: 1, rejected: 3 });
  });

  test("a sync the database refuses is rolled back whole (no orders, history or run), and the failure is recorded", async () => {
    await expect(sync("acct_rb", [order(70), order(0)])).rejects.toMatchObject({ code: "23514" });
    await asOwner(db);
    const n = async () =>
      (
        await db.query(`select (select count(*)::int from public.citypak_orders where account = 'acct_rb') o,
                               (select count(*)::int from public.citypak_order_history h join public.citypak_orders x on x.id = h.order_id where x.account = 'acct_rb') h,
                               (select count(*)::int from public.citypak_sync_runs where account = 'acct_rb') r`)
      ).rows[0];
    expect(await n()).toEqual({ o: 0, h: 0, r: 0 });
    await asService();
    await db.query("select public.citypak_record_failed_sync($1, 'acct_rb', 'live', 'save_failed', 1, 2, 'orders')", [courierId]);
    await asOwner(db);
    expect(await n()).toEqual({ o: 0, h: 0, r: 1 });
  });

  test("slice 1 compatibility after 030: the 6-argument failure call still records a bulk-uploads run", async () => {
    await asService();
    await db.query("select public.citypak_record_failed_sync($1, 'acct_compat', 'live', 'network', 0, 0)", [courierId]);
    await asOwner(db);
    expect((await db.query("select stream from public.citypak_sync_runs where account = 'acct_compat'")).rows).toEqual([{ stream: "bulk_uploads" }]);
  });

  test("L2: a person with Citypak history can't be hard-deleted (refused cleanly); history stays intact", async () => {
    const id = await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["courier"] });
    await asService();
    await db.query("select public.citypak_sync_orders($1, 'acct_del', 'live', $2::jsonb, 1, 0)", [id, JSON.stringify([order(80)])]);
    await asOwner(db);
    // FK refuses (23503) – not "set null", which would try to UPDATE append-only history.
    expect(await outcome(db, "delete from auth.users where id = $1", [id])).toBe("23503");
    expect((await db.query("select count(*)::int n from public.citypak_order_history where actor = $1", [id])).rows[0].n).toBe(1);
    const fk = (await db.query("select confdeltype from pg_constraint where conname = 'citypak_order_history_actor_fkey'")).rows[0];
    expect(fk.confdeltype).toBe("a"); // no action
  });
});

describe("matching with dispatch parcels (read-only)", () => {
  let p: ReadyParcel[] = [];
  let untracked = ""; // a finalised parcel with no tracking number yet
  let untrackedId = "";

  beforeAll(async () => {
    ({ parcels: p } = await readyRound(db, main, batch, "CPMATCH", 3));
    const [s] = await seedStudents(db, batch, ["CPU1"]);
    const { round } = await planRound(db, main, batch, "CPUNTR", [s]);
    await actAs(db, main);
    await db.query("select public.round_finalise($1)", [round]);
    await asOwner(db);
    ({ reference: untracked, id: untrackedId } = (await db.query("select id, reference from public.parcels where round_id = $1", [round])).rows[0]);
  });

  test("matched, reference only, conflicts and unmatched – from exact identifiers only", async () => {
    const [a, b, c] = p;
    await sync("acct_m", [
      order(1, { tracking_no: a.tracking, reference: a.reference }), // both agree
      order(2, { tracking_no: b.tracking, reference: "" }), // tracking only
      order(3, { tracking_no: null, reference: untracked }), // our parcel has no tracking yet
      order(4, { tracking_no: c.tracking, reference: b.reference }), // point to different parcels
      order(5, { tracking_no: "D899999999", reference: "NOPARCEL1" }), // nothing
      order(7, { tracking_no: "D877777777", reference: c.reference }), // reference found, tracking differs
    ]);
    // Reference only given, parcel has tracking. Own account: order 1 already uses this reference (a duplicate).
    await sync("acct_m8", [order(8, { tracking_no: null, reference: a.reference })]);
    const m = await matches("acct_m");
    expect(m[1]).toEqual({ status: "matched", reason: null, parcel: a.id });
    expect(m[2]).toEqual({ status: "matched", reason: null, parcel: b.id });
    expect(m[3]).toEqual({ status: "reference_only", reason: null, parcel: untrackedId });
    expect(m[4]).toMatchObject({ status: "conflict", reason: "different_parcels" });
    expect(m[5]).toEqual({ status: "unmatched", reason: null, parcel: null });
    expect(m[7]).toMatchObject({ status: "conflict", reason: "tracking_differs", parcel: c.id });
    expect((await matches("acct_m8"))[8]).toEqual({ status: "matched", reason: null, parcel: a.id });
  });

  test("a tracking number that matches but with a different reference is a conflict", async () => {
    await sync("acct_m2", [order(1, { tracking_no: p[0].tracking, reference: "SOMEOTHERREF" })]);
    expect((await matches("acct_m2"))[1]).toMatchObject({ status: "conflict", reason: "reference_differs", parcel: p[0].id });
  });

  test("two Citypak orders with the same tracking number are both conflicts", async () => {
    await sync("acct_dt", [order(1, { tracking_no: p[1].tracking, reference: p[1].reference }), order(2, { tracking_no: p[1].tracking, reference: "" })]);
    const m = await matches("acct_dt");
    expect(m[1]).toMatchObject({ status: "conflict", reason: "duplicate_tracking" });
    expect(m[2]).toMatchObject({ status: "conflict", reason: "duplicate_tracking" });
  });

  test("M1: two orders with the same reference are both conflicts – with a parcel tracking number or without", async () => {
    await sync("acct_dr", [
      order(1, { tracking_no: p[2].tracking, reference: p[2].reference }), // our parcel has tracking
      order(2, { tracking_no: "D833333331", reference: p[2].reference }),
      order(3, { tracking_no: null, reference: untracked }), // our parcel has no tracking yet
      order(4, { tracking_no: null, reference: untracked }),
      order(5, { tracking_no: "D833333335", reference: "NOPARCELDUP" }), // no parcel at all
      order(6, { tracking_no: "D833333336", reference: "NOPARCELDUP" }),
      order(7, { tracking_no: "D833333337", reference: "" }), // empty references are never duplicates
      order(8, { tracking_no: "D833333338", reference: "" }),
    ]);
    const m = await matches("acct_dr");
    for (const id of [1, 2, 3, 4, 5, 6]) expect(m[id], `order ${id}`).toMatchObject({ status: "conflict", reason: "duplicate_reference" });
    expect(m[7]).toEqual({ status: "unmatched", reason: null, parcel: null });
    expect(m[8]).toEqual({ status: "unmatched", reason: null, parcel: null });
    // Flagged for review only: both orders are still there, unmerged.
    await asOwner(db);
    expect((await db.query("select count(*)::int n from public.citypak_orders where account = 'acct_dr'")).rows[0].n).toBe(8);
  });

  test("duplicates are per account: the same tracking number or reference in another account is not a duplicate", async () => {
    await sync("acct_s1", [order(1, { tracking_no: p[0].tracking, reference: p[0].reference })]);
    await sync("acct_s2", [order(1, { tracking_no: p[0].tracking, reference: p[0].reference })]);
    expect((await matches("acct_s1"))[1]).toEqual({ status: "matched", reason: null, parcel: p[0].id });
    expect((await matches("acct_s2"))[1]).toEqual({ status: "matched", reason: null, parcel: p[0].id });
  });

  test("L1: demo (fixture) orders never match real parcels, even with colliding identifiers; demo duplicates still show", async () => {
    await sync("fixture", [
      order(9_900_001, { tracking_no: p[0].tracking, reference: p[0].reference }),
      order(9_900_002, { tracking_no: null, reference: untracked }),
      order(9_900_003, { tracking_no: p[1].tracking, reference: "" }),
      order(9_900_004, { tracking_no: "D844444444", reference: "FXODUP" }),
      order(9_900_005, { tracking_no: "D844444445", reference: "FXODUP" }),
    ]);
    await asOwner(db);
    const rows = (
      await db.query("select external_id, match_status, conflict_reason, parcel_id, tracking_parcel_id, reference_parcel_id from public.citypak_order_matches where account = 'fixture' and external_id between 9900001 and 9900005 order by external_id")
    ).rows;
    expect(rows.every((r) => r.parcel_id === null && r.tracking_parcel_id === null && r.reference_parcel_id === null)).toBe(true);
    expect(rows.map((r) => [r.match_status, r.conflict_reason])).toEqual([
      ["unmatched", null],
      ["unmatched", null],
      ["unmatched", null],
      ["conflict", "duplicate_reference"],
      ["conflict", "duplicate_reference"],
    ]);
  });

  test("matching follows parcel identifiers when they change (worked out when read)", async () => {
    await sync("acct_chg", [order(1, { tracking_no: "D855555555", reference: p[1].reference })]);
    expect((await matches("acct_chg"))[1]).toMatchObject({ status: "conflict", reason: "tracking_differs" });
    await asOwner(db);
    await db.query("begin");
    try {
      await db.query("update public.parcels set tracking_no = 'D855555555' where id = $1", [p[1].id]);
      const r = (await db.query("select match_status, parcel_id from public.citypak_order_matches where account = 'acct_chg'")).rows[0];
      expect(r).toEqual({ match_status: "matched", parcel_id: p[1].id });
    } finally {
      await db.query("rollback"); // test database only; the parcel goes back as it was
    }
    expect((await matches("acct_chg"))[1]).toMatchObject({ status: "conflict", reason: "tracking_differs" });
  });

  test("syncing and matching change no parcel, parcel event, round or COD record", async () => {
    await asOwner(db);
    const snapshot = async () =>
      (
        await db.query(`select
          (select md5(string_agg(p::text, ',' order by p.id)) from public.parcels p) as parcels,
          (select count(*) from public.parcel_events) as events,
          (select md5(string_agg(r::text, ',' order by r.id)) from public.dispatch_rounds r) as rounds,
          (select count(*) from public.cod_settlements) as settlements,
          (select count(*) from public.cod_settlement_lines) as lines`)
      ).rows[0];
    const before = await snapshot();
    await sync("acct_m3", p.map((x, i) => order(100 + i, { tracking_no: x.tracking, reference: x.reference })));
    await matches("acct_m3");
    expect(await snapshot()).toEqual(before);
  });
});

describe("reading", () => {
  test("courier and planners read orders, matches and history; others see nothing", async () => {
    await sync("acct_read", [order(60)]);
    for (const [a, n] of [[courier, 1], [planner, 1], [packer, 0], [viewer, 0]] as const) {
      await actAs(db, a);
      for (const t of ["citypak_orders", "citypak_order_matches"]) {
        expect((await db.query(`select count(*)::int n from public.${t} where account = 'acct_read'`)).rows[0].n, `${t}`).toBe(n);
      }
      expect(
        (await db.query("select count(*)::int n from public.citypak_order_history h join public.citypak_orders o on o.id = h.order_id where o.account = 'acct_read'")).rows[0].n,
      ).toBe(n);
    }
  });

  test("security definer functions: fixed search_path, server only; tables are read-only to users", async () => {
    await asOwner(db);
    const fns = (
      await db.query(`select p.proname, p.prosecdef, p.proconfig,
                             has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('anon', p.oid, 'execute') anon,
                             has_function_privilege('service_role', p.oid, 'execute') svc
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname in ('citypak_sync_orders', 'citypak_record_failed_sync')`)
    ).rows;
    expect(fns).toHaveLength(2);
    for (const f of fns) expect(f, f.proname).toMatchObject({ prosecdef: true, proconfig: ["search_path=\"\""], auth: false, anon: false, svc: true });
    for (const t of ["citypak_orders", "citypak_order_history"]) {
      for (const priv of ["insert", "update", "delete"]) {
        expect((await db.query("select has_table_privilege('authenticated', $1, $2) v", [`public.${t}`, priv])).rows[0].v, `${t} ${priv}`).toBe(false);
      }
    }
    await actAs(db, courier);
    expect(await outcome(db, "insert into public.citypak_orders (account, mode, external_id, payload_hash) values ('acct_x', 'live', 1, repeat('a', 32))")).toBe("42501");
  });

  test("the match view runs with the reader's rights and gives anon nothing", async () => {
    await asOwner(db);
    const r = (
      await db.query(`select c.reloptions, has_table_privilege('anon', c.oid, 'select') as anon,
                             has_table_privilege('authenticated', c.oid, 'insert') as auth_insert
                        from pg_class c join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'public' and c.relname = 'citypak_order_matches'`)
    ).rows[0];
    expect(r.reloptions).toContain("security_invoker=true");
    expect(r).toMatchObject({ anon: false, auth_insert: false });
  });
});
