// HTTP helpers for the (future, authorised) live Citypak provider. Pure apart
// from the injected fetch, so every failure path is unit tested without a network.
// Never logs request or response bodies.
import { isPdf } from "@/lib/dispatch/pdf-header";

export type CitypakErrorKind =
  | "unavailable"
  | "unauthorised"
  | "not_found"
  | "rate_limited"
  | "network"
  | "server"
  | "invalid_response"
  | "bad_document"
  | "too_large"
  | "unsupported";

export class CitypakError extends Error {
  constructor(
    readonly kind: CitypakErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = "CitypakError";
  }
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export type RequestOptions = {
  /** Extra attempts after the first, for network errors, 5xx and 429. */
  retries?: number;
  timeoutMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

/** One request with timeout and retries. 401/403/404 never retry. */
export async function request(fetchFn: FetchFn, url: string, init: RequestInit, opts: RequestOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 2;
  const sleep = opts.sleep ?? defaultSleep;
  let last: CitypakError = new CitypakError("network");
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoff(attempt, last));
    let res: Response;
    try {
      res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000), redirect: "error" });
    } catch {
      last = new CitypakError("network");
      continue;
    }
    if (res.ok) return res;
    if (res.status === 401 || res.status === 403) throw new CitypakError("unauthorised");
    if (res.status === 404) throw new CitypakError("not_found");
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after"));
      last = Object.assign(new CitypakError("rate_limited"), { retryAfterMs: Number.isFinite(wait) ? wait * 1000 : 0 });
      continue;
    }
    if (res.status >= 500) {
      last = new CitypakError("server");
      continue;
    }
    throw new CitypakError("invalid_response", `HTTP ${res.status}`);
  }
  throw last;
}

function backoff(attempt: number, last: CitypakError): number {
  const asked = (last as CitypakError & { retryAfterMs?: number }).retryAfterMs ?? 0;
  // Exponential with jitter, capped; a Retry-After up to 30 s is respected.
  const base = Math.min(500 * 2 ** (attempt - 1), 8000);
  return Math.min(Math.max(asked, base + Math.floor(Math.random() * 250)), 30_000);
}

export async function requestJson(fetchFn: FetchFn, url: string, init: RequestInit, opts?: RequestOptions): Promise<unknown> {
  const res = await request(fetchFn, url, { ...init, headers: { ...init.headers, Accept: "application/json" } }, opts);
  try {
    return await res.json();
  } catch {
    throw new CitypakError("invalid_response");
  }
}

export type DocumentKind = "xlsx" | "pdf";

/** Is this really the expected file? Decided by its first bytes, never its name or headers. */
export function checkDocument(bytes: Uint8Array, kind: DocumentKind): void {
  if (bytes.length === 0) throw new CitypakError("bad_document");
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new CitypakError("too_large");
  const ok =
    kind === "pdf"
      ? isPdf(bytes)
      : bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!ok) throw new CitypakError("bad_document");
}

export async function requestDocument(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  kind: DocumentKind,
  opts?: RequestOptions,
): Promise<Uint8Array> {
  const res = await request(fetchFn, url, init, opts);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) throw new CitypakError("too_large");
  const bytes = new Uint8Array(await res.arrayBuffer());
  checkDocument(bytes, kind);
  return bytes;
}
