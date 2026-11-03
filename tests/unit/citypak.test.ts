// Citypak slice 1: parsing, pagination, duplicates, failures, documents and
// provider selection. No network: every "Citypak" here is a fixture or a fake fetch.
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canPrint, citypakTime, parseBulkUploadPage, parsePrintSize, toDbRows, type BulkUploadPage } from "@/lib/citypak/bulk-uploads";
import { FIXTURE_ORDER_TOTAL, FIXTURE_TOTAL, fixtureBulkUploadsJson } from "@/lib/citypak/fixture";
import { checkDocument, CitypakError, MAX_DOCUMENT_BYTES, request, requestDocument, requestJson, type FetchFn } from "@/lib/citypak/http";
import { chooseProvider, createFixtureProvider, createLiveProvider, isAllowedBaseUrl } from "@/lib/citypak/provider";
import { collectBulkUploads, collectOrders, MAX_SYNC_ROWS } from "@/lib/citypak/sync";
import { orderDbRows, parseOrderPage } from "@/lib/citypak/orders";

const record = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  tracking_number: `B-${id}`,
  excel_file_url: `x/${id}.xlsx`,
  status: "SUCCESS",
  started_datetime: "2026-10-31 10:22:11",
  ended_datetime: "2026-10-31 10:23:00",
  created_at: "2026-10-31 10:22:11",
  waybills: 3,
  fileName: `f-${id}.xlsx`,
  ...over,
});
const envelope = (rows: unknown[], current = 1, last = 1) => ({
  status: true,
  data: { current_page: current, data: rows, last_page: last, per_page: 25, total: rows.length, next_page_url: null },
});
const noSleep = async () => {};
const kind = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof CitypakError ? e.kind : "other";
  }
};

describe("bulk-upload list", () => {
  test("reads Citypak's envelope and records", () => {
    const page = parseBulkUploadPage(envelope([record(255219)]));
    expect(page.rows[0]).toEqual({
      externalId: 255219,
      batchReference: "B-255219",
      fileName: "f-255219.xlsx",
      status: "SUCCESS",
      waybills: 3,
      hasOriginalExcel: true,
      startedAt: "2026-10-31T04:52:11.000Z", // no zone given → Sri Lanka time
      endedAt: "2026-10-31T04:53:00.000Z",
      createdAt: "2026-10-31T04:52:11.000Z",
    });
  });

  test("a bad record is skipped and counted; the rest still load", () => {
    const page = parseBulkUploadPage(
      envelope([record(1), { ...record(2), id: "abc" }, { ...record(3), status: "<script>" }, null, record(4, { status: "failed", waybills: null })]),
    );
    expect(page.rows.map((r) => r.externalId)).toEqual([1, 4]);
    expect(page.rows[1]).toMatchObject({ status: "FAILED", waybills: 0 });
    expect(page.rejected).toBe(3);
  });

  test.each([[null], ["<html>"], [{ data: [] }], [{ data: { current_page: 1 } }], [{ status: false }]])(
    "a wrong envelope is an invalid response (%#)",
    (json) => {
      expect(() => parseBulkUploadPage(json)).toThrow(CitypakError);
    },
  );

  test("times: zone-less is Sri Lanka, ISO kept, junk is null", () => {
    expect(citypakTime("2026-01-02T03:04:05Z")).toBe("2026-01-02T03:04:05.000Z");
    expect(citypakTime("2026-01-02 08:34")).toBe("2026-01-02T03:04:00.000Z");
    expect(citypakTime("yesterday")).toBeNull();
    expect(citypakTime("2026-13-45 99:99:99")).toBeNull();
    expect(citypakTime(null)).toBeNull();
  });

  test("rows for the database keep only batch data", () => {
    const [r] = toDbRows(parseBulkUploadPage(envelope([record(7)])).rows);
    expect(Object.keys(r).sort()).toEqual(
      ["batch_reference", "ended_at", "external_created_at", "external_id", "file_name", "has_original_excel", "started_at", "status", "waybills"].sort(),
    );
  });
});

describe("collecting every page", () => {
  const pages = (list: BulkUploadPage[]) => {
    const calls: number[] = [];
    return { calls, provider: { listBulkUploads: async (p: number) => (calls.push(p), list[p - 1]) } };
  };
  const pg = (ids: number[], current: number, last: number, rejected = 0): BulkUploadPage => ({
    ...parseBulkUploadPage(envelope(ids.map((i) => record(i)), current, last)),
    rejected,
  });

  test("reads all pages, counts rejects, keeps duplicates once", async () => {
    const { provider, calls } = pages([pg([1, 2], 1, 3), pg([2, 3], 2, 3, 1), pg([4], 3, 3)]);
    const r = await collectBulkUploads(provider);
    expect(calls).toEqual([1, 2, 3]);
    expect(r.rows.map((x) => x.externalId).sort()).toEqual([1, 2, 3, 4]);
    expect(r).toMatchObject({ pages: 3, rejected: 1, truncated: false });
  });

  test("follows a last page that grows while reading, and stops at the page limit", async () => {
    const grow = pages([pg([1], 1, 1), pg([2], 2, 2)]);
    grow.provider.listBulkUploads = async (p: number) => (grow.calls.push(p), p === 1 ? pg([1], 1, 2) : pg([2], 2, 2));
    expect((await collectBulkUploads(grow.provider)).rows).toHaveLength(2);

    const many = { listBulkUploads: async (p: number) => pg([p], p, 999) };
    const r = await collectBulkUploads(many, { maxPages: 5 });
    expect(r).toMatchObject({ pages: 5, truncated: true });
  });

  test("stops at the row cap (the database's limit) and says so", async () => {
    const big = { listBulkUploads: async (p: number) => pg([p * 10 + 1, p * 10 + 2, p * 10 + 3], p, 10) };
    const r = await collectBulkUploads(big, { maxRows: 5 });
    expect(r.rows).toHaveLength(5);
    expect(r.truncated).toBe(true);
    expect(r.pages).toBe(2);
  });

  test("a failure keeps how far it got, for the failure record", async () => {
    const progress = { pages: 0, rows: 0 };
    const provider = {
      listBulkUploads: async (p: number) => {
        if (p === 3) throw new CitypakError("server");
        return pg([p * 10 + 1, p * 10 + 2], p, 5);
      },
    };
    expect(await kind(collectBulkUploads(provider, {}, progress))).toBe("server");
    expect(progress).toEqual({ pages: 2, rows: 4 });
  });

  test("the sync row cap matches the database cap", () => {
    expect(MAX_SYNC_ROWS).toBe(20_000);
  });

  test("an empty account is fine", async () => {
    const r = await collectBulkUploads({ listBulkUploads: async () => pg([], 1, 0) });
    expect(r).toMatchObject({ rows: [], pages: 1 });
  });

  test("a failing page fails the whole sync (nothing half-saved)", async () => {
    const provider = {
      listBulkUploads: async (p: number) => {
        if (p === 2) throw new CitypakError("network");
        return pg([1], 1, 3);
      },
    };
    expect(await kind(collectBulkUploads(provider))).toBe("network");
  });

  test("the fixture provider gives every fixture batch, the same each time", async () => {
    const provider = createFixtureProvider();
    const a = await collectBulkUploads(provider);
    const b = await collectBulkUploads(provider);
    expect(a.rows).toHaveLength(FIXTURE_TOTAL);
    expect(a.pages).toBe(Math.ceil(FIXTURE_TOTAL / 25));
    expect(b).toEqual(a);
    expect(a.rows.some((r) => r.status === "FAILED" && r.waybills === 0)).toBe(true);
    expect(fixtureBulkUploadsJson(1).data.next_page_url).toMatch(/page=2/);
  });
});

describe("HTTP behaviour (fake fetch)", () => {
  const respond = (...answers: (Response | Error)[]): FetchFn & { calls: number } => {
    const f = (async () => {
      const a = answers[Math.min(f.calls++, answers.length - 1)];
      if (a instanceof Error) throw a;
      return a;
    }) as unknown as FetchFn & { calls: number };
    f.calls = 0;
    return f;
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  test("retries network errors and 5xx, then succeeds", async () => {
    const f = respond(new TypeError("fetch failed"), new Response("", { status: 502 }), json({ ok: 1 }));
    expect(await requestJson(f, "https://x/y", {}, { sleep: noSleep })).toEqual({ ok: 1 });
    expect(f.calls).toBe(3);
  });

  test("gives up after the retries", async () => {
    const f = respond(new Response("", { status: 503 }));
    expect(await kind(request(f, "https://x", {}, { retries: 2, sleep: noSleep }))).toBe("server");
    expect(f.calls).toBe(3);
  });

  test("429 waits for Retry-After", async () => {
    const waits: number[] = [];
    const f = respond(new Response("", { status: 429, headers: { "Retry-After": "7" } }), json({}));
    await requestJson(f, "https://x", {}, { sleep: async (ms) => void waits.push(ms) });
    expect(waits[0]).toBeGreaterThanOrEqual(7000);
  });

  test("401/403/404 stop at once", async () => {
    for (const [status, k] of [[401, "unauthorised"], [403, "unauthorised"], [404, "not_found"]] as const) {
      const f = respond(new Response("", { status }));
      expect(await kind(request(f, "https://x", {}, { sleep: noSleep }))).toBe(k);
      expect(f.calls).toBe(1);
    }
  });

  test("invalid JSON is an invalid response", async () => {
    const f = respond(new Response("<html>login</html>", { status: 200 }));
    expect(await kind(requestJson(f, "https://x", {}, { sleep: noSleep }))).toBe("invalid_response");
  });

  test("the live provider sends only a Bearer key and builds the observed paths", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      seen.push({ url, headers: init?.headers as Record<string, string> });
      return url.includes("/print") ? new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])) : json(envelope([record(9)]));
    };
    const live = createLiveProvider({
      baseUrl: "https://falcon.citypak.lk/client_panel_api/v1/",
      apiKey: "k".repeat(32),
      account: "acct",
      fetch: fetchFn,
    });
    await live.listBulkUploads(2);
    await live.waybills(255219, "4X6");
    expect(seen.map((s) => s.url)).toEqual([
      "https://falcon.citypak.lk/client_panel_api/v1/bulk-uploads?page=2",
      "https://falcon.citypak.lk/client_panel_api/v1/bulk-uploads/255219/print?page_size=4X6",
    ]);
    for (const s of seen) {
      expect(s.headers.Authorization).toBe(`Bearer ${"k".repeat(32)}`);
      expect(Object.keys(s.headers).map((h) => h.toLowerCase())).not.toContain("cookie");
    }
    expect(await kind(live.filledExcel(-5))).toBe("not_found");
  });
});

describe("documents", () => {
  const PK = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]);
  const PDF = new Uint8Array([0x0a, 0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

  test("the bytes decide the type, not the name", () => {
    expect(() => checkDocument(PK, "xlsx")).not.toThrow();
    expect(() => checkDocument(PDF, "pdf")).not.toThrow();
    expect(() => checkDocument(PDF, "xlsx")).toThrow(CitypakError);
    expect(() => checkDocument(PK, "pdf")).toThrow(CitypakError);
    expect(() => checkDocument(new Uint8Array(), "pdf")).toThrow(CitypakError);
    expect(() => checkDocument(new TextEncoder().encode("<html>session expired</html>"), "pdf")).toThrow(CitypakError);
  });

  test("too large is refused (declared or actual)", async () => {
    const declared = (async () => new Response(PDF, { headers: { "Content-Length": String(MAX_DOCUMENT_BYTES + 1) } })) as FetchFn;
    expect(await kind(requestDocument(declared, "https://x", {}, "pdf", { sleep: noSleep }))).toBe("too_large");
    const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    big.set(PDF);
    expect(() => checkDocument(big, "pdf")).toThrow(CitypakError);
  });

  test("fixture Excel and PDF are real files, clearly marked as fixtures", async () => {
    const provider = createFixtureProvider();
    const xlsx = await provider.filledExcel(900001);
    checkDocument(xlsx.bytes, "xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(xlsx.bytes) as unknown as ArrayBuffer);
    expect(String(wb.worksheets[0].getCell("A1").value)).toMatch(/FIXTURE/);

    const pdf = await provider.waybills(900001, "4X6");
    checkDocument(pdf.bytes, "pdf");
    const doc = await PDFDocument.load(pdf.bytes);
    expect(doc.getTitle()).toMatch(/FIXTURE/);
    expect(doc.getPage(0).getSize()).toEqual({ width: 288, height: 432 }); // 4×6 inches
    expect(await kind(provider.filledExcel(1))).toBe("not_found");
  });

  test("print sizes: only 4X6 until A4's parameter is confirmed", () => {
    expect(parsePrintSize("4x6")).toBe("4X6");
    for (const bad of ["A4", "a4", "", null, "4X6&x=1", "../"]) expect(() => parsePrintSize(bad)).toThrow(CitypakError);
  });

  test("failed or empty batches can't be printed", () => {
    expect(canPrint({ status: "SUCCESS", waybills: 3 })).toBe(true);
    expect(canPrint({ status: "FAILED", waybills: 3 })).toBe(false);
    expect(canPrint({ status: "SUCCESS", waybills: 0 })).toBe(false);
  });
});

describe("choosing the provider", () => {
  const live = {
    CITYPAK_MODE: "live",
    CITYPAK_LIVE_AUTHORISED: "yes",
    CITYPAK_API_KEY: "k".repeat(32),
    CITYPAK_BASE_URL: "https://falcon.citypak.lk/client_panel_api/v1",
    CITYPAK_ACCOUNT: "main",
  };

  test("fixture by default in development, off by default in production", () => {
    expect(chooseProvider({ NODE_ENV: "development" })).toMatchObject({ ok: true, provider: { mode: "fixture" } });
    expect(chooseProvider({ NODE_ENV: "production" })).toEqual({ ok: false, reason: "off" });
    expect(chooseProvider({ NODE_ENV: "production", CITYPAK_MODE: "fixture" })).toMatchObject({ ok: true });
  });

  test("live needs every setting, including written authorisation", () => {
    expect(chooseProvider(live)).toMatchObject({ ok: true, provider: { mode: "live", account: "main" } });
    for (const missing of Object.keys(live).filter((k) => k !== "CITYPAK_MODE")) {
      expect(chooseProvider({ ...live, [missing]: undefined })).toEqual({ ok: false, reason: "live_not_ready" });
    }
    expect(chooseProvider({ ...live, CITYPAK_LIVE_AUTHORISED: "true" })).toMatchObject({ ok: false });
    expect(chooseProvider({ ...live, CITYPAK_BASE_URL: "http://falcon.citypak.lk" })).toMatchObject({ ok: false });
    expect(chooseProvider({ ...live, CITYPAK_ACCOUNT: "fixture" })).toMatchObject({ ok: false }); // can't mix with demo rows
    expect(chooseProvider({ ...live, CITYPAK_API_KEY: "short" })).toMatchObject({ ok: false });
  });
});

describe("L8: the live key only goes to allowed Citypak hosts", () => {
  test.each([
    ["https://falcon.citypak.lk/client_panel_api/v1", true],
    ["https://staging.citypak.lk/customer_api/v1", true],
    ["http://falcon.citypak.lk", false], // not https
    ["https://falcon.citypak.lk.evil.example", false], // look-alike
    ["https://evil.example/falcon.citypak.lk", false],
    ["https://user:pass@falcon.citypak.lk", false], // login in URL
    ["https://falcon.citypak.lk:8443", false], // other port
    ["https://falcon.citypak.lk/?next=https://evil.example", false], // query
    ["https://citypak.lk", false], // not an observed host
    ["not a url", false],
  ])("%s → %s", (url, ok) => expect(isAllowedBaseUrl(url)).toBe(ok));

  test("live mode refuses other hosts, and the provider can't be built for one", () => {
    const env = {
      CITYPAK_MODE: "live",
      CITYPAK_LIVE_AUTHORISED: "yes",
      CITYPAK_API_KEY: "k".repeat(32),
      CITYPAK_ACCOUNT: "main",
    };
    expect(chooseProvider({ ...env, CITYPAK_BASE_URL: "https://falcon.citypak.lk.evil.example" })).toMatchObject({ ok: false });
    expect(() => createLiveProvider({ baseUrl: "https://evil.example", apiKey: "k".repeat(32), account: "main" })).toThrow(CitypakError);
  });

  test("redirects are refused, so the key can't follow one", async () => {
    let init: RequestInit | undefined;
    const f: FetchFn = async (_u, i) => ((init = i), new Response("{}"));
    await request(f, "https://falcon.citypak.lk/x", {}, { sleep: noSleep });
    expect(init?.redirect).toBe("error");
  });
});

describe("orders (orders/created)", () => {
  const ord = (id: unknown, over: Record<string, unknown> = {}) => ({ id, tracking_number: "D16950069", reference: "27TGNOVICT088", created_at: "2026-10-31 10:22:11", ...over });

  test("reads only the verified fields, normalising identifiers", () => {
    const page = parseOrderPage(envelope([ord(5, { tracking_number: " d1695 0069 ", reference: "27tgnovict088", status: "WHATEVER", receiver_name: "X" })]));
    expect(page.rows).toEqual([{ externalId: 5, trackingNo: "D16950069", reference: "27TGNOVICT088", createdAt: "2026-10-31T04:52:11.000Z" }]);
    expect(Object.keys(page.rows[0]).sort()).toEqual(["createdAt", "externalId", "reference", "trackingNo"]);
  });

  test("missing tracking or reference is allowed; a bad id or malformed identifier is skipped and counted", () => {
    const page = parseOrderPage(
      envelope([
        ord(1, { tracking_number: null, reference: undefined }),
        ord("2"),
        ord(null),
        ord(3, { tracking_number: "D1@#" }),
        ord(4, { reference: "has;semicolon" }),
        ord(0),
      ]),
    );
    expect(page.rows.map((r) => [r.externalId, r.trackingNo, r.reference])).toEqual([
      [1, null, ""],
      [2, "D16950069", "27TGNOVICT088"],
    ]);
    expect(page.rejected).toBe(4);
    expect(() => parseOrderPage({ data: "nope" })).toThrow(CitypakError);
  });

  // H1: ids must be positive safe integers – in orders AND bulk uploads (slice 1 used to coerce).
  const BAD_IDS: unknown[] = [0, "0", "000", "007", -5, "-5", 1.5, "1.5", Number.MAX_SAFE_INTEGER + 1, "9007199254740993", "1e3", "0x10", " 12", "12 ", "", true, false, [7], { id: 7 }, NaN, Infinity];
  test.each(BAD_IDS.map((id) => [id]))("id %j is malformed: skipped and counted, the valid records still load", (id) => {
    const orders = parseOrderPage(envelope([ord(1), ord(id), ord(2)]));
    expect(orders.rows.map((r) => r.externalId)).toEqual([1, 2]);
    expect(orders.rejected).toBe(1);
    const batches = parseBulkUploadPage(envelope([record(1), { ...record(1), id }, record(2)]));
    expect(batches.rows.map((r) => r.externalId)).toEqual([1, 2]);
    expect(batches.rejected).toBe(1);
  });

  test("valid ids: numbers and plain digit strings up to the largest safe integer", () => {
    const page = parseOrderPage(envelope([ord(1), ord("42"), ord(Number.MAX_SAFE_INTEGER), ord(String(Number.MAX_SAFE_INTEGER))]));
    expect(page.rows.map((r) => r.externalId)).toEqual([1, 42, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
    expect(page.rejected).toBe(0);
  });

  test("leading zeros in identifiers are kept (no numeric conversion)", () => {
    const [r] = parseOrderPage(envelope([ord(1, { tracking_number: "00120034", reference: "007ABC" })])).rows;
    expect(r).toMatchObject({ trackingNo: "00120034", reference: "007ABC" });
    expect(r.trackingNo).not.toBe("120034");
  });

  test("fixture orders: every page, the same each time, references never like real parcels", async () => {
    const provider = createFixtureProvider();
    const a = await collectOrders(provider);
    expect(a.rows).toHaveLength(FIXTURE_ORDER_TOTAL);
    expect(await collectOrders(provider)).toEqual(a);
    expect(a.rows.every((r) => r.reference === "" || r.reference.startsWith("FXO"))).toBe(true);
    // The demo includes one pair sharing a tracking number, and some orders without a reference.
    const counts = new Map<string, number>();
    for (const r of a.rows) if (r.trackingNo) counts.set(r.trackingNo, (counts.get(r.trackingNo) ?? 0) + 1);
    expect([...counts.values()].filter((n) => n > 1)).toEqual([2]);
    expect(a.rows.some((r) => r.reference === "")).toBe(true);
    expect(orderDbRows(a.rows.slice(0, 1))[0]).toEqual({
      external_id: a.rows[0].externalId,
      tracking_no: a.rows[0].trackingNo,
      reference: a.rows[0].reference,
      external_created_at: a.rows[0].createdAt,
    });
  });

  test("the live provider asks for orders/created by page only (no unverified filters), with the Bearer key", async () => {
    const seen: string[] = [];
    const fetchFn: FetchFn = async (url) => (seen.push(url), new Response(JSON.stringify(envelope([ord(9)]))));
    const live = createLiveProvider({ baseUrl: "https://falcon.citypak.lk/client_panel_api/v1", apiKey: "k".repeat(32), account: "main", fetch: fetchFn });
    expect((await live.listOrders(3)).rows).toHaveLength(1);
    expect(seen).toEqual(["https://falcon.citypak.lk/client_panel_api/v1/orders/created?page=3"]);
  });

  test("paging limits and duplicates behave the same as bulk uploads", async () => {
    const pages = [envelope([ord(1), ord(2)], 1, 3), envelope([ord(2, { reference: "LATER" }), ord(3)], 2, 3), envelope([ord(4)], 3, 3)];
    const r = await collectOrders({ listOrders: async (p: number) => parseOrderPage(pages[p - 1]) });
    expect(r.rows.map((x) => x.externalId).sort()).toEqual([1, 2, 3, 4]);
    expect(r.rows.find((x) => x.externalId === 2)?.reference).toBe("LATER");
    expect((await collectOrders({ listOrders: async (p: number) => parseOrderPage(envelope([ord(p)], p, 99)) }, { maxPages: 2 })).truncated).toBe(true);
  });
});

