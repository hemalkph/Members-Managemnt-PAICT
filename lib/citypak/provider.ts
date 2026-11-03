// Where Citypak data comes from. Server only.
//
//   fixture – synthetic demo data (default in development; opt-in in production)
//   live    – Citypak itself. OFF until Citypak authorises access in writing.
//             Needs CITYPAK_MODE=live, CITYPAK_LIVE_AUTHORISED=yes, CITYPAK_API_KEY,
//             CITYPAK_BASE_URL (https) and CITYPAK_ACCOUNT. Sends only a Bearer key –
//             never browser cookies or CSRF tokens. Read-only: no write calls exist.
//   off     – nothing is shown or fetched.
import "server-only";

import { parseBulkUploadPage, type BulkUploadPage, type PrintSize } from "./bulk-uploads";
import { fixtureBulkUploadsJson, fixtureExcel, fixtureHas, fixtureOrdersJson, fixtureWaybillCount, fixtureWaybills } from "./fixture";
import { CitypakError, requestDocument, requestJson, type FetchFn } from "./http";
import { parseOrderPage, type OrderPage } from "./orders";

export type CitypakMode = "fixture" | "live";

export type CitypakDocument = { bytes: Uint8Array; kind: "xlsx" | "pdf" };

export interface CitypakProvider {
  mode: CitypakMode;
  /** Our name for the Citypak merchant account; rows are kept per account. */
  account: string;
  listBulkUploads(page: number): Promise<BulkUploadPage>;
  /** Citypak's created orders, one page at a time (read-only). */
  listOrders(page: number): Promise<OrderPage>;
  filledExcel(externalId: number): Promise<CitypakDocument>;
  waybills(externalId: number, size: PrintSize): Promise<CitypakDocument>;
}

export type ProviderChoice = { ok: true; provider: CitypakProvider } | { ok: false; reason: "off" | "live_not_ready" };

export const FIXTURE_ACCOUNT = "fixture";

/**
 * The only hosts a live API key may ever be sent to. Both were seen in use but
 * are NOT yet confirmed by Citypak – confirming them is a pre-live blocker.
 * Redirects are refused (http.ts), so the key can't be forwarded elsewhere.
 */
export const CITYPAK_HOSTS = ["falcon.citypak.lk", "staging.citypak.lk"] as const;

/** An https URL on an allowed Citypak host, with no port, login or query. */
export function isAllowedBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    (CITYPAK_HOSTS as readonly string[]).includes(url.hostname) &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
  );
}

export function createFixtureProvider(): CitypakProvider {
  return {
    mode: "fixture",
    account: FIXTURE_ACCOUNT,
    async listBulkUploads(page) {
      return parseBulkUploadPage(fixtureBulkUploadsJson(page));
    },
    async listOrders(page) {
      return parseOrderPage(fixtureOrdersJson(page));
    },
    async filledExcel(id) {
      if (!fixtureHas(id)) throw new CitypakError("not_found");
      return { kind: "xlsx", bytes: await fixtureExcel(id, fixtureWaybillCount(id)) };
    },
    async waybills(id) {
      if (!fixtureHas(id)) throw new CitypakError("not_found");
      return { kind: "pdf", bytes: await fixtureWaybills(id, fixtureWaybillCount(id)) };
    },
  };
}

/**
 * The live provider, using the contracts observed in Citypak's dashboard.
 * Only reachable through chooseProvider() when every live setting is present.
 */
export function createLiveProvider(cfg: { baseUrl: string; apiKey: string; account: string; fetch?: FetchFn }): CitypakProvider {
  // Checked again here so no caller can build a live provider for another host.
  if (!isAllowedBaseUrl(cfg.baseUrl)) throw new CitypakError("unavailable", "Base URL is not an allowed Citypak host");
  const fetchFn: FetchFn = cfg.fetch ?? ((url, init) => fetch(url, init));
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const auth = { headers: { Authorization: `Bearer ${cfg.apiKey}` } };
  const id = (n: number) => {
    if (!Number.isSafeInteger(n) || n <= 0) throw new CitypakError("not_found");
    return String(n);
  };
  return {
    mode: "live",
    account: cfg.account,
    async listBulkUploads(page) {
      const p = Number.isSafeInteger(page) && page > 0 ? page : 1;
      return parseBulkUploadPage(await requestJson(fetchFn, `${base}/bulk-uploads?page=${p}`, auth));
    },
    async listOrders(page) {
      // Observed dashboard contract; the unverified `type` filter is not sent.
      const p = Number.isSafeInteger(page) && page > 0 ? page : 1;
      return parseOrderPage(await requestJson(fetchFn, `${base}/orders/created?page=${p}`, auth));
    },
    async filledExcel(n) {
      return { kind: "xlsx", bytes: await requestDocument(fetchFn, `${base}/bulk-uploads-filled-excel/${id(n)}`, auth, "xlsx") };
    },
    async waybills(n, size) {
      return {
        kind: "pdf",
        bytes: await requestDocument(fetchFn, `${base}/bulk-uploads/${id(n)}/print?page_size=${encodeURIComponent(size)}`, auth, "pdf"),
      };
    },
  };
}

type Env = Record<string, string | undefined>;

/** Which provider the server should use, from its environment. */
export function chooseProvider(env: Env = process.env): ProviderChoice {
  const mode = (env.CITYPAK_MODE ?? (env.NODE_ENV === "production" ? "off" : "fixture")).trim().toLowerCase();
  if (mode === "fixture") return { ok: true, provider: createFixtureProvider() };
  if (mode !== "live") return { ok: false, reason: "off" };
  const baseUrl = env.CITYPAK_BASE_URL?.trim() ?? "";
  const apiKey = env.CITYPAK_API_KEY?.trim() ?? "";
  const account = env.CITYPAK_ACCOUNT?.trim().toLowerCase() ?? "";
  const ready =
    env.CITYPAK_LIVE_AUTHORISED === "yes" &&
    apiKey.length >= 16 &&
    isAllowedBaseUrl(baseUrl) &&
    /^[a-z0-9_-]{1,40}$/.test(account) &&
    account !== FIXTURE_ACCOUNT;
  if (!ready) return { ok: false, reason: "live_not_ready" };
  return { ok: true, provider: createLiveProvider({ baseUrl, apiKey, account }) };
}
