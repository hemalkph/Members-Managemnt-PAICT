// Citypak server side (audit M5): the Sync action and the document routes,
// with the session, Supabase and Citypak replaced by fakes. No network.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  NOT_ALLOWED: "You are not signed in or not allowed to do this.",
  getActionContext: vi.fn(),
}));
vi.mock("@/lib/dispatch/access", () => ({ dispatchActionContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), hasServiceRoleKey: vi.fn(() => true) }));

import { syncCitypakBulkUploadsAction, syncCitypakOrdersAction } from "@/lib/actions/dispatch-citypak";
import { getActionContext } from "@/lib/auth";
import { serveCitypakDocument } from "@/lib/citypak/documents";
import { FIXTURE_ORDER_TOTAL, FIXTURE_TOTAL } from "@/lib/citypak/fixture";
import { dispatchActionContext } from "@/lib/dispatch/access";
import { dispatchNavItems } from "@/lib/dispatch/nav";
import { isMissingCitypakTables } from "@/lib/citypak/labels";
import { adminNav } from "@/lib/navigation";
import { PAGES, type AccessLevel, type PageKey } from "@/lib/page-access";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

const PERSON = "11111111-1111-4111-8111-111111111111";
const BATCH = "22222222-2222-4222-8222-222222222222";

type Call = [string, Record<string, unknown>];
/** A fake Supabase client: rpc answers by name, and one row for table reads. */
function fakeSupabase(opts: { rpc?: Record<string, { data?: unknown; error?: unknown }>; row?: unknown } = {}) {
  const calls: Call[] = [];
  const reads: string[] = [];
  return {
    calls,
    reads,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      return { data: null, error: null, ...(opts.rpc?.[name] ?? {}) };
    }),
    from: vi.fn((table: string) => {
      reads.push(table);
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: opts.row ?? null, error: null }) };
      return q;
    }),
  };
}

const env = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...env, CITYPAK_MODE: "fixture" };
  vi.mocked(hasServiceRoleKey).mockReturnValue(true);
});
afterEach(() => {
  process.env = env;
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------- Sync action
describe("Sync now", () => {
  const signedIn = () => vi.mocked(dispatchActionContext).mockResolvedValue({ profile: { id: PERSON } } as never);

  test("without the Courier permission nothing runs", async () => {
    vi.mocked(dispatchActionContext).mockResolvedValue(null);
    const r = await syncCitypakBulkUploadsAction();
    expect(r).toEqual({ ok: false, error: "You are not signed in or not allowed to do this." });
    expect(dispatchActionContext).toHaveBeenCalledWith("courier");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  test("off, or no service role on the server: unavailable, nothing runs", async () => {
    signedIn();
    process.env.CITYPAK_MODE = "off";
    expect((await syncCitypakBulkUploadsAction()).ok).toBe(false);
    process.env.CITYPAK_MODE = "fixture";
    vi.mocked(hasServiceRoleKey).mockReturnValue(false);
    expect((await syncCitypakBulkUploadsAction()).ok).toBe(false);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  test("saves through the service role with the verified actor, account and mode – never values from the browser", async () => {
    signedIn();
    const admin = fakeSupabase({ rpc: { citypak_sync_bulk_uploads: { data: { outcome: "ok", fetched: FIXTURE_TOTAL, new: FIXTURE_TOTAL, updated: 0, unchanged: 0, rejected: 0, truncated: false } } } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const r = await syncCitypakBulkUploadsAction();
    expect(r).toMatchObject({ ok: true, message: "Bulk uploads synced" });
    const [name, args] = admin.calls[0];
    expect(name).toBe("citypak_sync_bulk_uploads");
    expect(args).toMatchObject({ p_actor: PERSON, p_account: "fixture", p_mode: "fixture", p_pages: 2, p_truncated: false });
    expect(args.p_rows).toHaveLength(FIXTURE_TOTAL);
  });

  test("M2: a partial save is reported as not complete", async () => {
    signedIn();
    const admin = fakeSupabase({ rpc: { citypak_sync_bulk_uploads: { data: { outcome: "partial", fetched: 5, new: 5, updated: 0, unchanged: 0, rejected: 2, truncated: false } } } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const r = await syncCitypakBulkUploadsAction();
    expect(r).toMatchObject({ ok: true, message: "Synced, but not completely", data: { outcome: "partial", rejected: 2 } });
  });

  test("M1: a failed save is recorded by a separate call, with how far it got", async () => {
    signedIn();
    const admin = fakeSupabase({ rpc: { citypak_sync_bulk_uploads: { error: { code: "P0001", message: "Too many batches" } } } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const r = await syncCitypakBulkUploadsAction();
    expect(r).toEqual({ ok: false, error: "The batches couldn't be saved. Nothing was changed." });
    expect(admin.calls.map((c) => c[0])).toEqual(["citypak_sync_bulk_uploads", "citypak_record_failed_sync"]);
    expect(admin.calls[1][1]).toEqual({
      p_actor: PERSON,
      p_account: "fixture",
      p_mode: "fixture",
      p_error: "save_failed",
      p_pages: 2,
      p_fetched: FIXTURE_TOTAL,
      p_stream: "bulk_uploads",
    });
  });

  test("M1: if even the failure can't be recorded, the person is told so", async () => {
    signedIn();
    const admin = fakeSupabase({
      rpc: {
        citypak_sync_bulk_uploads: { error: { code: "P0001" } },
        citypak_record_failed_sync: { error: { code: "42501" } },
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await syncCitypakBulkUploadsAction();
    expect(r).toEqual({ ok: false, error: "The sync failed and the failure couldn't be recorded. Tell an admin." });
    // Only the error class and code are logged.
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Too many|<html>/);
    spy.mockRestore();
  });

  test("a Citypak failure (fake fetch, never the network) records the error class and saves nothing", async () => {
    signedIn();
    Object.assign(process.env, {
      CITYPAK_MODE: "live",
      CITYPAK_LIVE_AUTHORISED: "yes",
      CITYPAK_API_KEY: "k".repeat(32),
      CITYPAK_BASE_URL: "https://falcon.citypak.lk/client_panel_api/v1",
      CITYPAK_ACCOUNT: "main",
    });
    const fetchMock = vi.fn(async () => new Response("<html>login</html>", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const admin = fakeSupabase();
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const r = await syncCitypakBulkUploadsAction();
    expect(r).toEqual({ ok: false, error: "Citypak refused the credentials. Ask a main admin to check the Citypak settings." });
    expect(admin.calls).toEqual([
      ["citypak_record_failed_sync", { p_actor: PERSON, p_account: "main", p_mode: "live", p_error: "unauthorised", p_pages: 0, p_fetched: 0, p_stream: "bulk_uploads" }],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/falcon\.citypak\.lk\//);
  });
});

// ---------------------------------------------------------------- Sync now on Orders & waybills
describe("Sync now – orders", () => {
  const signedIn = () => vi.mocked(dispatchActionContext).mockResolvedValue({ profile: { id: PERSON } } as never);

  test("needs the Courier permission", async () => {
    vi.mocked(dispatchActionContext).mockResolvedValue(null);
    expect((await syncCitypakOrdersAction()).ok).toBe(false);
    expect(dispatchActionContext).toHaveBeenCalledWith("courier");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  test("saves every fixture order through the service role, with the verified actor and scope", async () => {
    signedIn();
    const admin = fakeSupabase({ rpc: { citypak_sync_orders: { data: { outcome: "ok", fetched: FIXTURE_ORDER_TOTAL, new: FIXTURE_ORDER_TOTAL, updated: 0, unchanged: 0, rejected: 0, truncated: false } } } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    expect(await syncCitypakOrdersAction()).toMatchObject({ ok: true, message: "Orders synced" });
    const [name, args] = admin.calls[0];
    expect(name).toBe("citypak_sync_orders");
    expect(args).toMatchObject({ p_actor: PERSON, p_account: "fixture", p_mode: "fixture", p_pages: 2, p_rejected: 0, p_truncated: false });
    const rows = args.p_rows as { external_id: number; tracking_no: string | null; reference: string }[];
    expect(rows).toHaveLength(FIXTURE_ORDER_TOTAL);
    // Only verified fields are sent.
    expect(Object.keys(rows[0]).sort()).toEqual(["external_created_at", "external_id", "reference", "tracking_no"]);
  });

  test("a failed save is recorded under the orders list", async () => {
    signedIn();
    const admin = fakeSupabase({ rpc: { citypak_sync_orders: { error: { code: "XX000" } } } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    expect(await syncCitypakOrdersAction()).toEqual({ ok: false, error: "The orders couldn't be saved. Nothing was changed." });
    expect(admin.calls[1]).toEqual([
      "citypak_record_failed_sync",
      { p_actor: PERSON, p_account: "fixture", p_mode: "fixture", p_error: "save_failed", p_pages: 2, p_fetched: FIXTURE_ORDER_TOTAL, p_stream: "orders" },
    ]);
  });

  test("Sync never calls anything that changes Tute dispatch", async () => {
    signedIn();
    const admin = fakeSupabase({ rpc: { citypak_sync_orders: { data: { outcome: "ok", fetched: 1, new: 1, updated: 0, unchanged: 0, rejected: 0, truncated: false } } } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    await syncCitypakOrdersAction();
    expect(admin.calls.map((c) => c[0])).toEqual(["citypak_sync_orders"]);
    expect(admin.from).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- document routes
describe("document routes", () => {
  const req = (path = `/admin/citypak/bulk-uploads/${BATCH}/waybills?size=4X6`) => new Request(`http://localhost${path}`);
  const batch = (over: Record<string, unknown> = {}) => ({
    id: BATCH,
    account: "fixture",
    mode: "fixture",
    external_id: 900001, // a successful fixture batch with waybills
    batch_reference: "FX-BATCH-0037",
    status: "SUCCESS",
    waybills: 8,
    ...over,
  });
  const as = (opts: { courier?: boolean; row?: unknown; logError?: unknown } = {}) => {
    const sb = fakeSupabase({
      row: opts.row,
      rpc: { has_dispatch: { data: opts.courier ?? true }, citypak_log_document: { error: opts.logError ?? null } },
    });
    vi.mocked(getActionContext).mockResolvedValue({ supabase: sb, profile: { id: PERSON } } as never);
    return sb;
  };

  test("a bad id is 404 before anything else", async () => {
    const res = await serveCitypakDocument(req(), "not-a-uuid", "excel");
    expect(res.status).toBe(404);
    expect(getActionContext).not.toHaveBeenCalled();
  });

  test("not signed in → login", async () => {
    vi.mocked(getActionContext).mockResolvedValue(null);
    const res = await serveCitypakDocument(req(), BATCH, "excel");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/login$/);
  });

  test("403 without the Courier permission; the batch is never read", async () => {
    const sb = as({ courier: false, row: batch() });
    const res = await serveCitypakDocument(req(), BATCH, "excel");
    expect(res.status).toBe(403);
    expect(sb.reads).toEqual([]);
  });

  test("404 for an unknown batch, and for a batch of another account or mode", async () => {
    as({ row: null });
    expect((await serveCitypakDocument(req(), BATCH, "excel")).status).toBe(404);
    as({ row: batch({ account: "main", mode: "live" }) });
    expect((await serveCitypakDocument(req(), BATCH, "excel")).status).toBe(404);
  });

  test("409 when there are no waybills to print; 400 for an unsupported size", async () => {
    as({ row: batch({ status: "FAILED", waybills: 0 }) });
    expect((await serveCitypakDocument(req(), BATCH, "waybills")).status).toBe(409);
    as({ row: batch() });
    expect((await serveCitypakDocument(req(`/x?size=A4`), BATCH, "waybills")).status).toBe(400);
  });

  test("503 when the integration is off", async () => {
    process.env.CITYPAK_MODE = "off";
    as({ row: batch() });
    expect((await serveCitypakDocument(req(), BATCH, "excel")).status).toBe(503);
  });

  test("200: a real file, private headers, marked as fixture, and the download is logged", async () => {
    const sb = as({ row: batch() });
    const excel = await serveCitypakDocument(req(), BATCH, "excel");
    expect(excel.status).toBe(200);
    expect(excel.headers.get("content-type")).toMatch(/spreadsheetml/);
    expect(excel.headers.get("content-disposition")).toBe('attachment; filename="citypak-FX-BATCH-0037-FIXTURE.xlsx"');
    expect(excel.headers.get("cache-control")).toBe("private, no-store");
    expect(excel.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = new Uint8Array(await excel.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const pdf = await serveCitypakDocument(req(), BATCH, "waybills");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(sb.calls.filter((c) => c[0] === "citypak_log_document").map((c) => c[1].p_kind)).toEqual(["filled_excel", "waybills_4x6"]);
  });

  test("if the download can't be logged, nothing is served", async () => {
    as({ row: batch(), logError: { code: "42501" } });
    const res = await serveCitypakDocument(req(), BATCH, "excel");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("text/plain");
  });
});

// ---------------------------------------------------------------- navigation and separation
describe("navigation", () => {
  const allAccess = Object.fromEntries(PAGES.map((p) => [p.key, "edit"])) as Record<PageKey, AccessLevel>;
  const sidebar = (citypak: boolean, access = allAccess) => adminNav(access, { citypak }).map((i) => i.href);

  test("Citypak integration is its own main-sidebar item, right after Tute dispatch", () => {
    const items = sidebar(true);
    expect(items).toContain("/admin/citypak");
    expect(items.indexOf("/admin/citypak")).toBe(items.indexOf("/admin/dispatch") + 1);
    const citypak = adminNav(allAccess, { citypak: true }).find((i) => i.href === "/admin/citypak");
    expect(citypak?.title).toBe("Citypak integration");
    // A collapsible parent: only built sections are listed (no links to future pages).
    expect(citypak?.children?.map((c) => [c.title, c.href])).toEqual([
      ["Bulk uploads", "/admin/citypak/bulk-uploads"],
      ["Orders & waybills", "/admin/citypak/orders"],
    ]);
  });

  test("hidden without the Courier/Plan permission, and without Tute dispatch access", () => {
    expect(sidebar(false)).not.toContain("/admin/citypak");
    expect(sidebar(true, { ...allAccess, dispatch: "none" })).not.toContain("/admin/citypak");
    // Existing callers (no options) are unchanged.
    expect(adminNav(allAccess).map((i) => i.href)).not.toContain("/admin/citypak");
  });

  test("Tute dispatch has no Citypak tab; its tabs are otherwise unchanged", () => {
    const all = dispatchNavItems(new Set(["plan", "courier", "finance", "pack", "verify", "correct"]), true);
    expect(all.map((i) => i.label)).toEqual(["Overview", "Rounds", "Saved tutes", "Students", "COD money", "Reports", "Settings"]);
    expect(all.some((i) => i.href.includes("citypak"))).toBe(false);
    expect(dispatchNavItems(new Set(), false).map((i) => i.href)).toEqual(["/admin/dispatch", "/admin/dispatch/rounds"]);
  });

  test("Citypak doesn't sit inside Tute dispatch, and dispatch pages contain nothing from it", () => {
    expect(existsSync("app/(app)/admin/dispatch/citypak")).toBe(false);
    expect(existsSync("app/(app)/admin/citypak/layout.tsx")).toBe(true);
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
    for (const f of files("app/(app)/admin/dispatch"))
      expect(readFileSync(f, "utf8"), f).not.toMatch(/lib\/citypak|admin\/citypak|CitypakSync|citypak_bulk|citypak_sync/i);
  });

  test("old links (under Tute dispatch, or batch pages/downloads without the section) redirect", async () => {
    const config = (await import("@/next.config")).default;
    const redirects = (await config.redirects!()) as { source: string; destination: string; permanent: boolean }[];
    const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    expect(redirects.map((r) => [r.source, r.destination, r.permanent])).toEqual([
      ["/admin/dispatch/citypak", "/admin/citypak/bulk-uploads", false],
      [`/admin/dispatch/citypak/:id(${uuid})/:rest*`, "/admin/citypak/bulk-uploads/:id/:rest*", false],
      [`/admin/citypak/:id(${uuid})/:rest*`, "/admin/citypak/bulk-uploads/:id/:rest*", false],
    ]);
  });

  test("/admin/citypak is a safe entry that goes to Bulk uploads", () => {
    const entry = readFileSync("app/(app)/admin/citypak/page.tsx", "utf8");
    expect(entry).toMatch(/redirect\("\/admin\/citypak\/bulk-uploads"\)/);
    // Access is checked by the module layout for every Citypak page.
    expect(readFileSync("app/(app)/admin/citypak/layout.tsx", "utf8")).toMatch(/requireDispatch\(\["courier", "plan"\]\)/);
    expect(existsSync("app/(app)/admin/citypak/bulk-uploads/[id]/excel/route.ts")).toBe(true);
    expect(existsSync("app/(app)/admin/citypak/bulk-uploads/[id]/waybills/route.ts")).toBe(true);
  });

  test("no horizontal Citypak section bar remains", () => {
    expect(readFileSync("app/(app)/admin/citypak/layout.tsx", "utf8")).not.toMatch(/<nav|SECTIONS/);
  });

  test("a missing-table error is recognised (migrations 028/029 not applied)", () => {
    expect(isMissingCitypakTables({ code: "PGRST205" })).toBe(true);
    expect(isMissingCitypakTables({ code: "42P01" })).toBe(true);
    expect(isMissingCitypakTables({ code: "42501" })).toBe(false);
    expect(isMissingCitypakTables(null)).toBe(false);
  });
});
