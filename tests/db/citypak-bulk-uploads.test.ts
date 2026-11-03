// Citypak bulk-upload batches: server-only saving (service role), idempotent
// sync, duplicates, complete / partial / failed runs, account and mode
// isolation, and read permissions. No Citypak calls – rows are passed in.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { parseBulkUploadPage, toDbRows } from "@/lib/citypak/bulk-uploads";
import { FIXTURE_TOTAL, fixtureBulkUploadsJson } from "@/lib/citypak/fixture";
import { actAs, asOwner, createPerson, outcome, session, type Actor } from "./helpers";

let db: pg.Client;
let courierId = "";
let courier: Actor;
let planner: Actor;
let packer: Actor;
let viewer: Actor;

beforeAll(async () => {
  db = await session();
  courierId = await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["courier"] });
  courier = { kind: "user", id: courierId, aal: "aal2" };
  planner = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["plan"] }), aal: "aal2" };
  packer = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "edit" }, grants: ["pack"] }), aal: "aal2" };
  viewer = { kind: "user", id: await createPerson(db, { pageAccess: { dispatch: "view" } }), aal: "aal2" };
});
afterAll(() => db.end());

const asService = async () => {
  await asOwner(db);
  await db.query("set role service_role");
};
const row = (id: number, over: Record<string, unknown> = {}) => ({
  external_id: id,
  batch_reference: `FX-${id}`,
  file_name: `fixture-${id}.xlsx`,
  status: "SUCCESS",
  waybills: 10,
  has_original_excel: true,
  started_at: "2026-10-01T10:00:00+05:30",
  ended_at: "2026-10-01T10:01:00+05:30",
  external_created_at: "2026-10-01T10:00:00+05:30",
  ...over,
});
/** The way the server saves a sync: service role, with the actor it verified. */
const sync = async (account: string, rows: object[], opts: { mode?: string; rejected?: number; truncated?: boolean } = {}) => {
  await asService();
  return (
    await db.query("select public.citypak_sync_bulk_uploads($1, $2, $3, $4::jsonb, 1, $5, $6) as r", [
      courierId,
      account,
      opts.mode ?? (account === "fixture" ? "fixture" : "live"),
      JSON.stringify(rows),
      opts.rejected ?? 0,
      opts.truncated ?? false,
    ])
  ).rows[0].r;
};
const runs = async (account: string) => {
  await asOwner(db);
  return (
    await db.query(
      "select outcome, error_class, fetched, rejected_count, truncated from public.citypak_sync_runs where account = $1 order by created_at, id",
      [account],
    )
  ).rows;
};
const count = async (account: string) => {
  await asOwner(db);
  return (await db.query("select count(*)::int as n from public.citypak_bulk_uploads where account = $1", [account])).rows[0].n;
};

describe("H1: only the server can save synced batches", () => {
  test("signed-in users can't call the save or failure functions directly, whatever their permission", async () => {
    const rows = JSON.stringify([row(9001, { waybills: 999 })]);
    for (const a of [courier, planner, packer, viewer]) {
      await actAs(db, a);
      expect(
        await outcome(db, "select public.citypak_sync_bulk_uploads($1, 'main', 'live', $2::jsonb, 1, 0, false)", [
          (a as { id: string }).id,
          rows,
        ]),
      ).toBe("42501");
      expect(
        await outcome(db, "select public.citypak_record_failed_sync($1, 'main', 'live', 'network')", [(a as { id: string }).id]),
      ).toBe("42501");
      expect(await outcome(db, "select public.citypak_check_scope($1, 'main', 'live')", [(a as { id: string }).id])).toBe("42501");
    }
    // The old, browser-callable version is gone.
    await actAs(db, courier);
    expect(await outcome(db, "select public.citypak_sync_bulk_uploads('main', 'live', $1::jsonb, 1, 0, false, null)", [rows])).not.toBe("ok");
    expect(await count("main")).toBe(0);
  });

  test("the service role can save, with a real active actor", async () => {
    expect(await sync("acct_svc", [row(9101)])).toMatchObject({ outcome: "ok", new: 1 });
    await asService();
    expect(
      await outcome(db, "select public.citypak_sync_bulk_uploads($1, 'acct_svc', 'live', '[]'::jsonb, 1, 0)", [
        "00000000-0000-0000-0000-000000000000",
      ]),
    ).toBe("42501");
  });

  test("demo account and live mode can never mix", async () => {
    await asService();
    for (const [account, mode] of [["fixture", "live"], ["main", "fixture"]]) {
      expect(
        await outcome(db, "select public.citypak_sync_bulk_uploads($1, $2, $3, '[]'::jsonb, 1, 0)", [courierId, account, mode]),
      ).toBe("P0001");
      expect(await outcome(db, "select public.citypak_record_failed_sync($1, $2, $3, 'network')", [courierId, account, mode])).toBe(
        "P0001",
      );
    }
    // And the tables refuse it even for the database owner.
    await asOwner(db);
    expect(
      await outcome(
        db,
        "insert into public.citypak_bulk_uploads (account, mode, external_id, status, payload_hash) values ('fixture', 'live', 1, 'SUCCESS', repeat('a', 32))",
      ),
    ).toBe("23514");
  });

  test("bad account names and bad rows are refused", async () => {
    await asService();
    expect(await outcome(db, "select public.citypak_sync_bulk_uploads($1, 'Bad Account!', 'live', '[]'::jsonb, 0, 0)", [courierId])).toBe(
      "P0001",
    );
    await expect(sync("acct_bad", [row(5001, { status: "drop table" })])).rejects.toMatchObject({ code: "23514" });
    await expect(sync("acct_bad", [row(-1)])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("sync results", () => {
  test("first sync adds, repeat sync changes nothing, a changed batch is updated", async () => {
    const rows = [row(1001), row(1002, { status: "FAILED", waybills: 0 })];
    expect(await sync("acct_a", rows)).toMatchObject({ outcome: "ok", new: 2, updated: 0, unchanged: 0 });
    expect(await sync("acct_a", rows)).toMatchObject({ new: 0, updated: 0, unchanged: 2 });
    expect(await sync("acct_a", [row(1001, { waybills: 12 }), rows[1]])).toMatchObject({ updated: 1, unchanged: 1 });
    expect(await count("acct_a")).toBe(2);
    await asOwner(db);
    const failed = (await db.query("select status, waybills from public.citypak_bulk_uploads where account = 'acct_a' and external_id = 1002")).rows[0];
    expect(failed).toEqual({ status: "FAILED", waybills: 0 });
  });

  test("the same batch twice in one sync is saved once (last wins)", async () => {
    expect(await sync("acct_dup", [row(2001, { waybills: 1 }), row(2001, { waybills: 5 })])).toMatchObject({ fetched: 1, new: 1 });
    await asOwner(db);
    expect((await db.query("select waybills from public.citypak_bulk_uploads where account = 'acct_dup'")).rows).toEqual([{ waybills: 5 }]);
  });

  test("M2: stopping at a limit or skipping records is 'partial', not complete – and the next sync completes it", async () => {
    expect(await sync("acct_part", [row(7001)], { truncated: true })).toMatchObject({ outcome: "partial", new: 1 });
    expect(await sync("acct_part", [row(7001), row(7002)], { rejected: 2 })).toMatchObject({ outcome: "partial", new: 1, unchanged: 1 });
    expect(await sync("acct_part", [row(7001), row(7002), row(7003)])).toMatchObject({ outcome: "ok", new: 1, unchanged: 2 });
    expect((await runs("acct_part")).map((r) => r.outcome)).toEqual(["partial", "partial", "ok"]);
    expect(await count("acct_part")).toBe(3);
  });

  test("M1: a failed save rolls back, and the failure is still recorded by its own call", async () => {
    await sync("acct_fail", [row(3001)]);
    const big = Array.from({ length: 20001 }, (_, i) => row(i + 1));
    await expect(sync("acct_fail", big)).rejects.toMatchObject({ code: "P0001" });
    expect(await count("acct_fail")).toBe(1); // nothing from the failed save
    await asService();
    await db.query("select public.citypak_record_failed_sync($1, 'acct_fail', 'live', 'save_failed', 50, 20001)", [courierId]);
    expect(await runs("acct_fail")).toEqual([
      { outcome: "ok", error_class: null, fetched: 1, rejected_count: 0, truncated: false },
      { outcome: "failed", error_class: "save_failed", fetched: 20001, rejected_count: 0, truncated: false },
    ]);
    // Error classes only – never messages or response bodies.
    await asService();
    expect(
      await outcome(db, "select public.citypak_record_failed_sync($1, 'acct_fail', 'live', 'HTTP 500: <html>…', 0, 0)", [courierId]),
    ).toBe("P0001");
  });

  test("accounts never mix: the same Citypak id in two accounts is two rows", async () => {
    await sync("acct_x", [row(4001, { waybills: 1 })]);
    await sync("acct_y", [row(4001, { waybills: 99 })]);
    await asOwner(db);
    const rows = (await db.query("select account, waybills from public.citypak_bulk_uploads where external_id = 4001 order by account")).rows;
    expect(rows).toEqual([{ account: "acct_x", waybills: 1 }, { account: "acct_y", waybills: 99 }]);
  });
});

describe("fixture data end to end", () => {
  test("syncing the fixture batches twice: all new, then all unchanged", async () => {
    const rows = [1, 2].flatMap((p) => toDbRows(parseBulkUploadPage(fixtureBulkUploadsJson(p)).rows));
    expect(rows).toHaveLength(FIXTURE_TOTAL);
    expect(await sync("fixture", rows)).toMatchObject({ outcome: "ok", new: FIXTURE_TOTAL, unchanged: 0 });
    expect(await sync("fixture", rows)).toMatchObject({ new: 0, updated: 0, unchanged: FIXTURE_TOTAL });
    await asOwner(db);
    const failed = (await db.query("select count(*)::int as n from public.citypak_bulk_uploads where account = 'fixture' and status = 'FAILED'")).rows[0].n;
    expect(failed).toBeGreaterThan(0);
  });
});

describe("reading and download logging", () => {
  test("courier and planners can read; others see nothing", async () => {
    await sync("acct_perm", [row(6001)]);
    for (const [a, n] of [[courier, 1], [planner, 1], [packer, 0], [viewer, 0]] as const) {
      await actAs(db, a);
      expect((await db.query("select count(*)::int as n from public.citypak_bulk_uploads where account = 'acct_perm'")).rows[0].n).toBe(n);
      expect((await db.query("select count(*)::int as n from public.citypak_sync_runs where account = 'acct_perm'")).rows[0].n).toBe(n);
    }
  });

  test("downloads are logged for courier only", async () => {
    await asOwner(db);
    const id = (await db.query("select id from public.citypak_bulk_uploads where account = 'acct_perm'")).rows[0].id;
    await actAs(db, courier);
    await db.query("select public.citypak_log_document($1, 'waybills_4x6')", [id]);
    expect(await outcome(db, "select public.citypak_log_document($1, 'a4')", [id])).toBe("P0001");
    await actAs(db, planner);
    expect(await outcome(db, "select public.citypak_log_document($1, 'filled_excel')", [id])).toBe("42501");
    await asOwner(db);
    expect(
      (await db.query("select count(*)::int as n from public.activity_log where action = 'dispatch.citypak_document' and entity_id = $1", [id]))
        .rows[0].n,
    ).toBe(1);
  });
});
