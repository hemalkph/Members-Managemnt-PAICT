# Citypak (Falcon) integration – audit and plan

Status: **slice 1 built (fixture mode only)** – read-only Bulk Uploads screen
with sanitised fixture data (see §7). Live access stays switched off until
Citypak authorises it in writing and credentials are configured. Everything
else in this document is still a plan.

---

## 1. Audit of the current Tute Dispatch system

| Area | What exists today | Where |
|---|---|---|
| Stack | Next.js 16 (App Router, server actions), Supabase (Postgres 17, RLS, Storage, Realtime), Vercel (`sin1`) | `package.json`, `vercel.json` |
| Access | Page access `dispatch` (none/view/edit) + capabilities `plan, courier, pack, verify, correct, finance` via `has_dispatch()`; main admins need two-step login (aal2) | migration 018, `lib/dispatch/access.ts` |
| Write path | **Every write goes through a `SECURITY DEFINER` SQL function** with an empty `search_path`; tables are SELECT-only through RLS. Catalogue test enforces it | migrations 018–027, `tests/db/catalogue.test.ts` |
| Rounds | `dispatch_rounds` → finalise freezes `parcels` (fixed `reference` = prefix + student no., unique forever), `parcel_recipients` (personal data, plan/courier only), `parcel_items` | migration 019 |
| Tracking numbers | Citypak sheet upload → `reconcileTracking()` preview → `tracking_apply()` (all-or-nothing, idempotent, conflicts stop the import) → `registration_state = registered` | `lib/dispatch/tracking.ts`, migration 019 |
| Waybill PDF | Uploaded PDF stored privately; labels cross-checked against the manifest (never the source of identity) | `recordWaybillAction`, `checkWaybills()` |
| Courier files | `carrier_files` (kind, sha256, private bucket path, dedupe on round+kind+hash), download logging, retention deletion | migrations 019, 022 |
| Delivery | `parcels.delivery_state` (`awaiting_pickup → handed_over → in_transit → delivered / failed / returned`) changed only by `handover_confirm` and `delivery_set` (manual, with reason) | migration 021, `lib/dispatch/delivery.ts` |
| History | `parcel_events` append-only (trigger blocks update/delete), `source in ('manual','import','system','scan')` | migration 019 |
| COD | `cod_settlements` (reference unique, draft → confirmed/cancelled) + `cod_settlement_lines` (parcel, collected, fee); write-offs; `dispatch_cod_rows()` / `round_close_check()` compute outstanding from **confirmed** lines only | migration 022 |
| Money types | `numeric(12,2)` in the database; app formats with `formatLKR(Number(...))` (display only) | |
| Scheduled jobs | `pg_cron` → `call_app_hook()` (pg_net) → `POST /api/hooks/*` with `APP_HOOK_SECRET` (constant-time check) → service-role client | `app/api/hooks/cleanup/route.ts`, migration 012 |
| Secrets | Server-only env vars (service role key, hook secret); nothing secret reaches the browser | `lib/env.ts`, `lib/supabase/admin.ts` |
| Tests | Unit (vitest) + DB tests against a throwaway local Postgres (refuses non-local URLs, strips `SUPABASE*` env), migrations applied twice | `vitest.db.config.ts`, `tests/db/global-setup.ts` |
| Language | Every dispatch UI text has Sinhala; test fails otherwise | `lib/dispatch/i18n/si.ts`, `tests/unit/i18n.test.ts` |

**Conclusion:** the integration is another *source* for data the system already
models (tracking numbers, delivery states, COD lines, courier files). It must
feed the same SQL functions and history, not build a parallel dispatch model.

---

## 2. Endpoint discovery matrix

Legend: ✅ observed (contract partly known) · 🔶 known to exist, contract unknown · ❓ unknown

### 2a. Key-based customer API (the only one the backend may call)

| Need | Endpoint | Status | Notes |
|---|---|---|---|
| Auth | `Authorization: Bearer <API key>` | ✅ (third-party code) | Key must be **issued by Citypak** |
| Track one parcel | `GET https://falcon.citypak.lk/customer_api/v1/track?tracking_number=…` → `{ is_success, data }` | ✅ (shape of `data` unknown) | Source: public repo `ceyflow/audrey-care-ops` – **third-party evidence, not verified with Citypak** |
| Staging host | `https://staging.citypak.lk` | ✅ (third-party) | Needed for all testing |
| Status history / status values | – | ❓ | Need the full list and meaning |
| Push / webhooks | – | 🔶 mentioned | Signing, retries, payload unknown |
| Create orders / pickups / waybill print | – | 🔶 mentioned | **Out of scope until owner approves a write phase** |
| Bulk uploads, orders list, COD, Excel, PDF | – | ❓ | Ask Citypak whether `customer_api` exposes them |

**Caveat on `customer_api`:** the only evidence is one third-party repository.
Its existence, its auth scheme and its scope are unverified. A `customer_api`
key may cover tracking only; it must **not** be assumed to grant the dashboard
operations in 2b (bulk uploads, documents, COD). Scope has to be confirmed by
Citypak in writing.

### 2b. Dashboard endpoints (`client_panel_api`) – reference contracts, **not authorised for server use**

Base: `https://falcon.citypak.lk/client_panel_api/v1`

| Need | Endpoint | Status | Known |
|---|---|---|---|
| Bulk upload list | `GET /bulk-uploads?page=N` | ✅ | Pagination `status`, `data.current_page`, `data.data[]`, `data.last_page`, `data.per_page`, `data.total`, `data.next_page_url`. Record: `id` (numeric batch id), `tracking_number` (**batch reference, not a parcel tracking no.**), `excel_file_url` (original upload path), `status` `SUCCESS`/`FAILED`, `started_datetime`, `ended_datetime`, `created_at`, `waybills` (count), `fileName`. Observed 154 records, 25/page, 7 pages – observations, not constants |
| Filled Excel of a batch | `GET /bulk-uploads-filled-excel/{id}` | ✅ | 200, XLSX body, Excel MIME, `Content-Disposition: attachment` with .xlsx name. Citypak's **generated** workbook (may differ from the uploaded one) |
| Waybill PDF of a batch | `GET /bulk-uploads/{id}/print?page_size=4X6` | ✅ | 200, `application/pdf`, `Content-Disposition: inline; filename="waybill.pdf"` |
| A4 print | `…/print?page_size=?` | 🔶 | A4 exists; parameter value unverified → **not offered** |
| Batch details / its waybills | – | ❓ | No per-batch waybill list captured |
| Created orders | `GET /orders/created?page&from_date&to_date&type` | ✅ | Same pagination; order has `id, tracking_number, reference, created_at…` |
| COD payments | `GET /cod-payments?page&from_date&to_date` | ✅ | `batch_cod_settlement_id`, money fields, processing status, nested `batch_cod_settlement` |
| COD summary | `…/cod-payment-summary` | 🔶 | URL and params unconfirmed |
| Single order status & history | – | ❓ | |
| Per-waybill settlement breakdown | – | ❓ | Collected, courier fee, other deductions per tracking no. |

These run on the browser session (cookie/CSRF or a user token). Copying that
session into the server is **not allowed**. Use them to (1) know what data
exists, (2) ask Citypak to provide it through the key-based API, and (3) build
fixtures for tests.

---

## 3. Proposed architecture (additive)

```
Citypak (customer_api, Bearer key, staging first)
        │  server only
lib/citypak/client.ts      ← HTTP adapter: base URL, key, timeouts, retry w/ backoff,
                              rate limit, pagination loop, no logging of bodies
lib/citypak/schemas.ts     ← zod schemas per endpoint; unknown fields ignored, bad rows rejected
lib/citypak/normalise.ts   ← pure: Citypak record → our shape (status map, money as strings/cents)
        │
lib/actions/dispatch-citypak.ts  (manual "Sync now", courier/finance caps)
app/api/hooks/citypak/route.ts   (scheduled, APP_HOOK_SECRET, service role)
        │  rpc only
SQL functions (SECURITY DEFINER): citypak_sync_start/finish, citypak_apply_tracking,
citypak_apply_statuses, citypak_stage_settlement
        │
existing tables + functions: parcels, parcel_events, tracking_apply, delivery_set rules,
cod_settlements (draft), carrier_files
```

### 3.0 Four different things – kept apart

| Concept | Our table | Identity | Relation |
|---|---|---|---|
| Internal dispatch round | `dispatch_rounds` | our uuid | has many `parcels` |
| Citypak bulk-upload batch | `citypak_bulk_uploads` (**built, slice 1**) | (`account`, Citypak numeric `id`) | one uploaded sheet → N waybills. **Not** a round: a round may be uploaded in several batches, a batch may hold parcels of several rounds or none. No link to rounds is stored until waybill-level data proves it |
| Courier waybill | `citypak_shipments` (planned) | tracking no. | matches one `parcels` row by tracking no. / reference |
| COD settlement batch + records | `citypak_cod_records` (planned) → draft `cod_settlements` | Citypak settlement batch id + tracking no. | |

`citypak_bulk_uploads` is justified for slice 1 (not only "because it was
proposed"): Sync now must be idempotent and auditable, the screen must work when
Citypak is unreachable, access must follow RLS, and fixture and future live data
must never mix (rows are keyed by `account`, and fixture rows by `mode`).

### 3.1 New tables (proposed – not created)

| Table | Purpose |
|---|---|
| `citypak_settings` (or columns on `dispatch_settings`) | integration on/off, environment (staging/production), last successful sync per stream. **Key is NOT stored in the DB** – Vercel env `CITYPAK_API_KEY` |
| `citypak_shipments` | one row per Citypak order: `external_id` (unique), `tracking_no` (unique), `reference`, `parcel_id` (nullable = unmatched), `courier_status` (raw text), `courier_status_at`, `first_seen_at`, `last_seen_at`, `payload_hash`. No names/addresses/phones stored |
| `citypak_sync_runs` | audit: stream, trigger (manual/schedule), actor, started/finished, pages, fetched/new/updated/unchanged/unmatched/failed counts, error class (never raw bodies) |
| `citypak_cod_records` | per tracking no. per Citypak settlement batch: `batch_id`, `collected`, `fee`, `other_deductions`, `net` (`numeric(12,2)`), `payment_status` (raw), unique (`batch_id`, `tracking_no`) |

### 3.2 Matching (stable identifiers)

1. **Tracking number** – unique on both sides; primary key for matching.
2. **Our reference** (e.g. `27TGNOVICT088`) – when Citypak returns it, it must equal `parcels.reference`; a mismatch is a **conflict**, never auto-fixed.
3. Never match by name, phone or address.
Unmatched Citypak records are kept (`parcel_id null`) and listed for review – e.g. orders made outside the system.

### 3.3 Status separation

| Kind | Values | Owner |
|---|---|---|
| Internal dispatch | `pack_state`, `delivery_state`, `registration_state` | our functions only |
| Courier status | raw Citypak text, stored as-is in `citypak_shipments` | Citypak |
| Bulk-upload processing | raw batch status | Citypak |
| COD settlement | raw `payment_status` + our `cod_settlements.state` | both, kept apart |

A **mapping table** (reviewed by the owner) turns courier statuses into
`delivery_state` moves. Only allowed forward moves are applied automatically,
through the same rules as `delivery_set` (`source = 'citypak'`, a new
`parcel_events.source` value). Corrections backwards (e.g. delivered →
failed) are **not** automatic – they are flagged for a person.

### 3.4 Money rules

- Parse money from JSON **as strings**, validate `^-?\d+(\.\d{1,2})?$`, convert to integer cents in TypeScript; all sums in Postgres `numeric`.
- Negative balances (deductions larger than collections) are stored and shown as such, never clamped.
- `payment_status: COMPLETED` = Citypak *processed* it, **not** that money reached the bank. Synced COD data only creates a **draft** settlement; a finance person still confirms it (existing flow), optionally after matching the bank deposit.

### 3.5 Idempotency and safety

- Upserts keyed by `external_id` / `tracking_no` / (`batch_id`, `tracking_no`); unchanged rows (same `payload_hash`) are skipped.
- One sync per stream at a time (`pg_advisory_xact_lock`), so manual and scheduled runs can't overlap.
- Incremental windows (`from_date` = last success − 2 days overlap), full re-scan available to main admins.
- Retries: 3 attempts, exponential backoff with jitter, only for timeouts/5xx/429 (respect `Retry-After`); 401/403 stop the run and mark the integration "credentials need attention".
- Hard limits: page cap per run, request timeout, per-minute request budget.
- Logs contain counts and error classes only – no response bodies, no personal data.
- Read-only against Citypak in Phases A–C. No order creation or bulk submission.
- Manual file imports keep working; a synced value never silently overwrites a different value from a file – it becomes a conflict.

### 3.6 Documents (Excel / PDF)

Only through an endpoint Citypak authorises. Fetched server-side, size- and
type-checked (`isPdf`, xlsx magic bytes), stored in the private `dispatch`
bucket as `carrier_files` (existing dedupe by sha256, retention, download log).

### 3.7 UI (later)

Integration panel in Dispatch → Settings (status, last sync, credentials state,
Sync now), per-round "Citypak" tab (matched/unmatched, courier status,
conflicts), COD money page shows staged Citypak settlements to confirm.

---

## 4. Sequenced plan

| Phase | Scope | Needs first |
|---|---|---|
| **0 – Access** | Owner obtains API key + staging access + Falcon customer API docs from Citypak | Citypak (needed for **live** only) |
| **1 – Bulk uploads (fixture)** ✅ | Read-only Bulk Uploads screen, sync, documents – fixture provider only | nothing |
| **A – Tracking status (read-only)** | `client.ts`, schemas, `citypak_shipments`, `citypak_sync_runs`; Sync now per round calls `track` for parcels with tracking numbers; shows courier status; no state changes yet | key, staging, status list |
| **B – Apply delivery states** | Owner-approved status map; apply forward moves via SQL with `source='citypak'`; conflicts list; daily schedule | Phase A in use for ≥1 round |
| **C – Orders list & matching** | If an authorised orders endpoint exists: import orders, fill missing tracking numbers through `tracking_apply` rules, unmatched list | authorised endpoint |
| **D – COD** | Authorised COD endpoint → `citypak_cod_records` → draft `cod_settlements`; negative balances; finance confirms | authorised endpoint |
| **E – Documents** | Excel/PDF via authorised endpoints into `carrier_files` | authorised endpoint |
| **F – Webhooks** | Signed push endpoint replacing polling | Citypak webhook spec |
| **G – Writes (separate approval)** | Create orders / bulk upload from a finalised round | **explicit owner approval** |

### Tests (fixture-driven, no network)

`lib/citypak/client.ts` takes an injected `fetch`; tests use recorded, **redacted** fixtures.

- Pagination: 1, many and empty pages; `last_page` changes mid-run
- Duplicates: same tracking no. twice in one response and across runs
- Repeat sync: second run reports all unchanged; no duplicate events
- New vs updated records; status moving forward, backwards (→ conflict), unknown status (→ stored, not applied)
- Failures: timeout, 500 then success (retry), 429 with `Retry-After`, 401/403 (stop, flag credentials), malformed JSON, schema-invalid rows (rejected, counted)
- Money: string parsing, cents arithmetic, negative net, `COMPLETED` stays draft
- Unmatched records; reference/tracking conflicts with existing parcels
- Cross-account isolation: records for another merchant account id are rejected
- Manual import + sync on the same parcel: agreement = no-op, disagreement = conflict
- PDF/XLSX: wrong content type, oversized, corrupt file
- DB: catalogue (definer/search_path/grants) for every new function; RLS on new tables; migrations safe to run twice

### Risks

| Risk | Control |
|---|---|
| Using undocumented dashboard endpoints | Backend never calls `client_panel_api` |
| Key leak | Vercel env only, never DB/logs/browser; rotate on staff change |
| Wrong delivery state applied | Owner-approved map, forward-only, conflicts to humans, full `parcel_events` trail |
| Money mistakes | strings → cents, Postgres numeric, drafts only, finance confirms |
| Citypak downtime / changes | Retries, schema validation, file import remains the fallback |
| Personal data exposure | Store ids/status/money only; recipients stay in `parcel_recipients` |

---

## 5. What to capture in Chrome DevTools

For **each** action below: Network tab → filter **Fetch/XHR** → click the request → copy **as text** (not as cURL).

**Before sharing, remove:** `Cookie`, `Authorization`, `X-XSRF-TOKEN`/`X-CSRF-TOKEN` values, and every name, phone, address, bank detail in responses (replace with `REDACTED`). Keep field **names**, types and example **shapes**; trim lists to 2 records.

Actions:
1. Bulk Upload page load (list of batches) and moving to page 2
2. Opening one batch (its waybills)
3. Batch **Excel download** click
4. Batch **Print** click
5. Orders → Created page, page 2, and a date filter; also each `type` value you can choose
6. Opening one order (detail and status history, if shown)
7. COD payments page, page 2, date filter
8. The **cod-payment-summary** request
9. Opening one COD settlement batch (per-waybill breakdown, if shown)
10. Any page that shows delivery statuses (to collect every status value)

For each request record:
- Method and full URL path with query parameter **names** (and allowed values)
- Request header **names** only (to see whether it uses cookies, CSRF or a bearer token)
- Status code; response `Content-Type`; for files, the `Content-Disposition` filename pattern
- Response JSON structure (redacted), including pagination fields
- Behaviour when the session expires (status code / body shape)

Also ask Citypak (in writing): whether `customer_api` exposes the same data, the full courier status list, the COD fields' meaning (collected, fee, deductions, net, payment status), webhook availability, rate limits, and terms of use.

---

## 6. Blockers for owner review

Fixture-based development (adapters, schemas, persistence, UI, tests) needs **no**
credentials. The items below block **live** integration only.

**Pre-live security requirements (must be done before live documents or syncs):**

- **M3 – document size while downloading.** Live documents are read fully into memory before the size check when Citypak sends no `Content-Length`. Read the body in chunks and stop at 15 MB; describe the route as buffered, not streamed, until then.
- **M4 – download audit.** Log failed attempts (403/404/409/upstream errors) as well as successes, log after the file is actually produced, and don't report a logging failure as "Not allowed".
- **L8 – where the key may go (raised to a blocker).** The key is sent only to `CITYPAK_HOSTS` (`falcon.citypak.lk`, `staging.citypak.lk`) over https with no port, login or query, and redirects are refused. **Both hosts are only observed – Citypak must confirm them in writing** before live mode is switched on; update the list if they name others.

1. **No Citypak-issued API key or documentation yet** – blocks every live call.
2. **No staging access** – required before the first live call.
3. **Dashboard (`client_panel_api`) endpoints are not authorised for server use** – only usable as a reference unless Citypak confirms otherwise in writing.
4. **Status mapping** (courier status → our delivery state) must be approved by the owner.
5. **Write phase (order creation / bulk upload)** stays closed until separately approved.

---

## 7. Slice 1 – Bulk uploads (fixture mode)

Built: read-only Citypak → Bulk uploads screen in Tute dispatch.

| Part | Where |
|---|---|
| Provider interface, mode selection (`fixture` default, `live` gated) | `lib/citypak/provider.ts` |
| Response schemas + normalisation (rejects bad rows, never throws on one bad row) | `lib/citypak/bulk-uploads.ts` |
| HTTP helpers for the future live provider (timeout, retry on 5xx/429, 401/403 stop, binary checks) | `lib/citypak/http.ts` |
| Fixture provider: synthetic batches, generated XLSX/PDF clearly marked "FIXTURE – not a Citypak document" | `lib/citypak/fixture.ts` |
| Sync (all pages, page cap, dedupe, one transaction) | `lib/citypak/sync.ts`, `lib/actions/dispatch-citypak.ts` |
| Tables `citypak_bulk_uploads`, `citypak_sync_runs`; `citypak_log_document` | migration 028 |
| Server-only saving (`citypak_sync_bulk_uploads`, `citypak_record_failed_sync`), outcomes ok/partial/failed, demo-account rule | migration 029 |
| Citypak area (own layout, header, section bar), list, detail page, document routes | `app/(app)/admin/citypak/…` |

Rules in this slice:
- **Live mode is off.** It turns on only with `CITYPAK_MODE=live`, `CITYPAK_LIVE_AUTHORISED=yes`, `CITYPAK_API_KEY`, `CITYPAK_BASE_URL` and `CITYPAK_ACCOUNT` set on the server. Without all of them the screen shows "unavailable"; nothing is called.
- The live provider sends only `Authorization: Bearer <key>`. No cookies, no CSRF tokens.
- Documents are **streamed, not stored**: fetched server-side per click, checked (XLSX zip signature / PDF marker, size ≤ 15 MB), sent with `Cache-Control: no-store`, and each download is logged. Storing courier documents (with recipient data) in `carrier_files` waits until a batch can be tied to a round, so the existing retention rules can apply.
- Print size: only `4X6` (A4's parameter is unverified).
- No batch is linked to a round, and no shipment or delivery state is created or changed.
- Who: `courier` or `plan` can view; `courier` can sync and download.
- **Separate module.** Citypak is its own Admin module, not a Tute dispatch tab. In the main sidebar, "Citypak integration" is a collapsible group (shadcn `Collapsible` + `SidebarMenuSub`) whose sections are listed in `CITYPAK_NAV` (`lib/navigation.ts`) – only **Bulk uploads** today; Orders, Delivery tracking, COD settlements and Settings are added there, as their own routes, when built (no links to pages that don't exist). Routes: `/admin/citypak` (entry → redirects to the first section), `/admin/citypak/bulk-uploads`, `/admin/citypak/bulk-uploads/[id]` (+ `/excel`, `/waybills`). Older links (`/admin/dispatch/citypak/…`, `/admin/citypak/[id]/…`) redirect (`next.config.ts`). The module layout holds the access check, header and Demo/Live/Off state. Nothing Citypak is shown on the dispatch overview or round pages (unit-tested).

### 7.1 Audit fixes (slice 1)

| Finding | Fix |
|---|---|
| H1 – a Courier could call the save function directly with made-up rows | Save functions run as **service role only**. The server action checks the person's Courier permission with their own session, then saves with the admin client, passing the actor, account and mode it decided. The database refuses demo-account/live-mode mixes (`citypak_check_scope` and table checks). The old browser-callable function is dropped |
| M1 – a failed save left no record | Failures are recorded by **a separate call** (`citypak_record_failed_sync`, its own transaction) with the error class and progress (pages, rows). If that also fails, the person is told. Row cap 20,000 is the same in the app (`MAX_SYNC_ROWS`) and the database |
| M2 – incomplete runs looked successful | Outcomes `ok` / `partial` / `failed`. Partial = stopped at a limit or skipped records; its batches are saved (nothing is deleted, so the next sync completes the list). The screen shows the last run's outcome and, separately, the **last complete** sync time; the toast warns on partial |
| M5 – no route/action tests | `tests/unit/citypak-server.test.ts` (action, routes, navigation, separation) and `tests/db/citypak-bulk-uploads.test.ts` (direct-call denial, service role, isolation, outcomes) |

---

## 8. Slice 2 – Orders & waybills (fixture mode)

Built: Citypak integration → **Orders & waybills** (`/admin/citypak/orders`, `/admin/citypak/orders/[id]`), a second section in the sidebar group. Read-only towards Citypak and towards Tute dispatch.

### Data

| Object | Purpose |
|---|---|
| `citypak_orders` (migration 030) | One row per Citypak order, keyed by (`account`, Citypak `id`). Only **verified** fields: `tracking_no`, `reference`, `external_created_at`, plus sync times and a payload hash. **No courier status** (its values are unverified) and **no recipient data**. Not linked to bulk uploads, rounds or COD. Same demo-account/mode rule as bulk uploads |
| `citypak_order_history` | Append-only: first seen, and every change of tracking number or reference (old → new, who synced) |
| `citypak_sync_runs` | Now also stream `orders` (same ok / partial / failed outcomes) |
| `citypak_sync_orders()` | Service role only; same pattern as `citypak_sync_bulk_uploads` (scope check, per-account lock, last-wins duplicates, 20,000 cap, never deletes) |
| `citypak_record_failed_sync(…, p_stream)` | Now names its stream (default `bulk_uploads`) |
| View `citypak_order_matches` | `security_invoker` – matching worked out **when read**, never stored |

The planned `citypak_shipments` became `citypak_orders`: it mirrors Citypak's "orders/created" list and keeps Citypak's own word.

### Matching (informational only)

Only exact identifiers: the order's tracking number against `parcels.tracking_no`, and its reference against `parcels.reference` (both unique). Never names, phones or addresses.

| Result | When |
|---|---|
| `matched` | Both point to the same parcel, or only one was given and it was found |
| `reference_only` | The reference matches a parcel that has no tracking number yet |
| `conflict` | `different_parcels` (tracking → one parcel, reference → another), `reference_differs` (tracking found, its parcel has another reference), `tracking_differs` (reference found, its parcel has another tracking number), `duplicate_tracking` / `duplicate_reference` (another Citypak order of the same account and mode has the same tracking number / non-empty reference – possibly a reshipment, so both are flagged for review; neither is merged or removed) |
| `unmatched` | Neither identifier is on any parcel |

Only **live** orders are compared with parcels. Demo (fixture) orders never match a real parcel, even when an identifier collides; they still show demo-to-demo duplicates, and the screens say so.

Nothing is written to Tute dispatch: no tracking numbers assigned, no pack/delivery state changes, no COD records, no round changes (DB-tested with a before/after snapshot).

### Still unverified for live use

The full order schema, status values and their meaning, the `type` filter (not sent), the date filters (not used – all pages are read), and whether `reference` always carries our parcel reference.

### 8.1 Audit fixes (slice 2)

| Finding | Fix |
|---|---|
| H1 – invalid order ids (0, "000", …) | One shared id rule for orders **and** bulk uploads (`externalIdSchema`): a positive safe integer, as a JSON number or a plain digit string with no leading zero. No coercion – `0`, `"000"`, `"007"`, negatives, decimals, `"1e3"`, `" 12"`, booleans, arrays and values above 2^53−1 are malformed. Slice 1 had the same weakness (`z.coerce` turned `true` into 1); fixed too. A malformed record is skipped and counted, the rest of the sync is saved, and the run is `partial` |
| M1 – duplicate references | `citypak_order_matches` flags `duplicate_reference` (same account and mode, non-empty reference, a different order row). `duplicate_tracking` takes priority when both apply. Existing contradiction checks are unchanged |
| L1 – fixture vs real parcels | Parcels are joined only for `mode = 'live'`. Demo screens show a "Demo orders are never matched with real dispatch parcels" notice |
| L2 – history actor vs user deletion | Confirmed: `on delete set null` would UPDATE append-only history, so the trigger aborted the delete with a misleading "history cannot be changed" error. Now a plain foreign key: deleting a profile that has Citypak history is refused cleanly (23503) and history stays intact. This follows the project's rule – people are **deactivated** (`profiles.is_active`), never hard-deleted, and `parcel_events.actor` already blocks deletion the same way. **Impact (low):** a person who ever ran an orders sync can't be hard-deleted from Supabase Auth; deactivate them instead. No bypass of the append-only trigger was added |
| L3 – page past the end | Orders and Bulk uploads redirect to the last page (or page 1 if PostgREST refuses the range with PGRST103) instead of showing "no orders match" / a load error |
| L4 – orders with no tracking number and no reference | Kept: nothing in the observed responses says they are invalid, and dropping them would hide Citypak data. They show as `#<Citypak id>`, `unmatched`, and are never treated as duplicates of each other |
| L5 – identifier normalisation | Identifiers stay text: upper case, spaces removed – the same form `parcels` keeps (`^[A-Z0-9]{4,30}$` / `^[A-Z0-9]{2,40}$`). Leading zeros are kept (unit-tested) and matching is exact equality, so normalisation can't merge two different identifiers beyond case and spaces |
| Lockfile | The 55-line `package-lock.json` deletion (optional `ajv` peer entries pruned by a local `npm install`) was unrelated to slice 2 – restored. Slice 2 adds no dependencies |

### 8.2 Stale sync (M2) – must be fixed before live or scheduled sync

**The race.** A sync reads every page first, then saves in one database call that takes a per-account advisory lock. The lock only orders the *saves*, not the *snapshots*:

1. Run A reads order X (tracking `T1`) at t0 and is slow to finish reading.
2. Citypak changes X to `T2`. Run B reads X (`T2`) at t1 and saves at t2.
3. Run A saves at t3 > t2: it waits for the lock, then overwrites X back to `T1`, writes a false "changed `T2` → `T1`" history entry and moves `last_seen_at` forward.

Nothing in the save can tell that A's data is older than what is already stored. In fixture mode the data never changes and sync is manual, so there is no impact today.

**Pre-live solution (both parts, in the database):**

1. **Lease before fetching.** A new `citypak_sync_begin(actor, account, mode, stream)` (service role) takes a row in `citypak_sync_leases (account, stream, generation, holder_run, started_at, lease_until)` *before any page is read*: it increments `generation`, stamps `started_at = now()` (database clock, not the app's), and refuses with `busy` while another unexpired lease exists. It returns `(generation, started_at)`.
2. **Save only if still current.** `citypak_sync_orders` / `citypak_sync_bulk_uploads` take `p_generation`, lock the lease row (`for update`), and raise `stale_sync` unless `p_generation` is the current generation and the lease hasn't expired. Each row upsert also carries `where o.last_seen_at <= p_started_at`, so even after an expired lease a run can never overwrite a row saved by a run that *started later*. A refused stale save is recorded as a `failed` run (`stale_sync`) and changes nothing.

This makes freshness a database-enforced ordering on fetch start, not on lock order. Live and scheduled sync stay off until it is built and DB-tested (two overlapping runs, the older saving last, must change nothing).

