// Read every page of a Citypak list from a provider. Pure apart from the
// provider, so pagination, duplicates, limits and failures are unit tested.
// Used for bulk uploads and orders alike.
import type { BulkUpload, Page } from "./bulk-uploads";
import type { CitypakOrder } from "./orders";
import type { CitypakProvider } from "./provider";

export const MAX_PAGES = 50;
/** The most records one sync may save – the same cap as the database sync functions. */
export const MAX_SYNC_ROWS = 20_000;

export type Collected<T> = { rows: T[]; pages: number; rejected: number; truncated: boolean };
/** How far a sync got, kept up to date while reading so a failure can be recorded with it. */
export type Progress = { pages: number; rows: number };
export type Limits = { maxPages?: number; maxRows?: number };

/**
 * Page 1, 2, … until the last page Citypak reports (it may change while we
 * read). Stops early – and says so with `truncated` – at MAX_PAGES or
 * MAX_SYNC_ROWS. The same record on two pages is kept once (the later copy
 * wins). Any failure throws; `progress` then shows how far it got.
 */
export async function collectPages<T>(
  fetchPage: (page: number) => Promise<Page<T>>,
  idOf: (row: T) => number,
  limits: Limits = {},
  progress: Progress = { pages: 0, rows: 0 },
): Promise<Collected<T>> {
  const maxPages = limits.maxPages ?? MAX_PAGES;
  const maxRows = limits.maxRows ?? MAX_SYNC_ROWS;
  const byId = new Map<number, T>();
  let rejected = 0;
  let page = 1;
  let lastPage = 1;
  let truncated = false;
  while (page <= lastPage) {
    if (page > maxPages || byId.size >= maxRows) {
      truncated = true;
      break;
    }
    const res = await fetchPage(page);
    progress.pages++;
    rejected += res.rejected;
    for (const r of res.rows) {
      const id = idOf(r);
      if (!byId.has(id) && byId.size >= maxRows) {
        truncated = true;
        continue;
      }
      byId.set(id, r);
    }
    progress.rows = byId.size;
    lastPage = res.lastPage;
    page++;
  }
  return { rows: [...byId.values()], pages: progress.pages, rejected, truncated };
}

export function collectBulkUploads(
  provider: Pick<CitypakProvider, "listBulkUploads">,
  limits: Limits = {},
  progress?: Progress,
): Promise<Collected<BulkUpload>> {
  return collectPages((p) => provider.listBulkUploads(p), (r) => r.externalId, limits, progress);
}

export function collectOrders(
  provider: Pick<CitypakProvider, "listOrders">,
  limits: Limits = {},
  progress?: Progress,
): Promise<Collected<CitypakOrder>> {
  return collectPages((p) => provider.listOrders(p), (r) => r.externalId, limits, progress);
}
