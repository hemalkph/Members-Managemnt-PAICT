// Every dispatch object must be locked down: privileged functions pin their
// search_path and are not callable by anon; tables give anon nothing and
// signed-in users SELECT only (through RLS).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { asOwner, session } from "./helpers";

const FUNCTIONS = [
  "has_dispatch",
  "dispatch_my_caps",
  "dispatch_grant",
  "dispatch_revoke",
  "dispatch_settings_save",
  "student_save",
  "student_set_active",
  "student_import_start",
  "students_import_apply",
  "round_save",
  "round_set_tutes",
  "round_set_students",
  "round_cancel",
  "round_finalise",
  "parcel_correct",
  "carrier_file_record",
  "tracking_apply",
  "citypak_template_set",
  "dispatch_log_download",
  "scan_lookup",
  "parcel_scan_confirm",
  "parcel_unpack",
  "exception_open",
  "exception_resolve",
  "parcel_assign",
  "dispatch_packers",
  "dispatch_pack_list",
  "handover_open",
  "handover_scan",
  "handover_release",
  "handover_confirm",
  "handover_cancel",
  "dispatch_handover_list",
  "delivery_set",
  "parcel_void",
  "parcel_replace",
  "dispatch_cod_rows",
  "settlement_save",
  "settlement_add_lines",
  "settlement_set_line",
  "settlement_remove_line",
  "settlement_attach",
  "settlement_confirm",
  "settlement_cancel",
  "cod_writeoff_set",
  "dispatch_settlements",
  "round_close_check",
  "round_close",
  "round_reopen",
  "dispatch_report_rounds",
  "dispatch_report_people",
  "student_delete",
  "dispatch_batch_clear",
  "dispatch_tute_save",
  "dispatch_tute_archive",
  "dispatch_tute_counts",
  "round_copy",
];
/** Privileged helpers used only inside other functions: nobody may call them directly. */
const INTERNAL = [
  "dispatch_require",
  "dispatch_lock_draft",
  "dispatch_name",
  "dispatch_can_pack",
  "dispatch_parcel_card",
  "dispatch_block_reason",
  "sync_parcel_hold",
  "dispatch_handover_block",
  "dispatch_round_totals",
  "dispatch_settlement_draft",
  "dispatch_retention_run",
  "dispatch_retention_files",
  "dispatch_retention_mark_deleted",
];
const TABLES = [
  "dispatch_grants",
  "dispatch_settings",
  "students",
  "student_imports",
  "dispatch_rounds",
  "round_tutes",
  "round_students",
  "parcels",
  "parcel_recipients",
  "parcel_items",
  "parcel_events",
  "carrier_files",
  "parcel_exceptions",
  "parcel_scans",
  "handovers",
  "handover_parcels",
  "cod_settlements",
  "cod_settlement_lines",
  "dispatch_tutes",
];

let db: pg.Client;
beforeAll(async () => {
  db = await session();
  await asOwner(db);
});
afterAll(() => db.end());

describe("dispatch functions", () => {
  test.each([...FUNCTIONS, ...INTERNAL])("%s is SECURITY DEFINER with an empty search_path", async (name) => {
    const { rows } = await db.query(
      `select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [name],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.prosecdef).toBe(true);
      expect(r.proconfig).toContain('search_path=""');
    }
  });

  test.each(FUNCTIONS)("%s cannot be executed by anon or PUBLIC", async (name) => {
    const { rows } = await db.query(
      `select has_function_privilege('anon', p.oid, 'execute') as anon,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) as public_
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [name],
    );
    for (const r of rows) {
      expect(r.anon).toBe(false);
      expect(r.public_).toBe(false);
    }
  });

  test.each([...INTERNAL, "parcel_events_append_only", "round_student_gets"])("%s cannot be called by signed-in users either", async (name) => {
    const { rows } = await db.query(
      `select has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`,
      [name],
    );
    expect(rows).toEqual([{ auth: false, anon: false }]);
  });
});

describe("dispatch tables", () => {
  test.each(TABLES)("%s: RLS on, nothing for anon, SELECT only for authenticated", async (table) => {
    const { rows } = await db.query(
      `select c.relrowsecurity as rls,
              has_table_privilege('anon', c.oid, 'select') as anon_select,
              has_table_privilege('anon', c.oid, 'insert') as anon_insert,
              has_table_privilege('authenticated', c.oid, 'select') as auth_select,
              has_table_privilege('authenticated', c.oid, 'insert') as auth_insert,
              has_table_privilege('authenticated', c.oid, 'update') as auth_update,
              has_table_privilege('authenticated', c.oid, 'delete') as auth_delete,
              has_table_privilege('authenticated', c.oid, 'truncate') as auth_truncate
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = $1`,
      [table],
    );
    expect(rows[0]).toEqual({
      rls: true,
      anon_select: false,
      anon_insert: false,
      auth_select: true,
      auth_insert: false,
      auth_update: false,
      auth_delete: false,
      auth_truncate: false,
    });
  });

  test("the dispatch bucket is private with a 15 MB limit", async () => {
    const { rows } = await db.query("select public, file_size_limit from storage.buckets where id = 'dispatch'");
    expect(rows[0]).toEqual({ public: false, file_size_limit: "15728640" });
  });
});
