# Phase 5: Review limit and phone review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work gets reviewed within a set number of hours. Reviewers get one reminder a day when work waits too long, can approve from the phone in one tap (with Undo), and members can see how long their work has waited and where approved money goes.

**Architecture:**
- **Migration 082:** `app_settings.review_limit_hours`, a read function any signed-in user can call, a set function for review editors, and a reminder job every 2 hours from 08:00 to 20:00 Colombo.
- **Pure helpers** in `lib/review/waiting.ts` for the waiting time and its text.
- **UI:** phone cards on Work review (below `md`), a limit setting and an "over the limit" line on the review page, and three changes to the member's submission card.

**Tech Stack:** Next.js 16.4, Supabase Postgres + pg_cron, sonner toasts, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-manager-tools-design.md` §Phase 5. The spec numbers this migration 081, but stage times took 081, so this is **082** and Phase 6 becomes 083.

## Global Constraints

- **Branch:** `feature/review-limit` from origin/main (a0257f7).
- **Migration file:** `supabase/migrations/20270103000082_review_limit.sql`, safe to run twice. Functions are `security definer` with `search_path = ''`, and every UPDATE has a WHERE.
- **Waiting starts** at `coalesce(resubmitted_at, created_at)` for `status = 'pending'`.
- **Limit:** a whole number of hours from 1 to 168; the default is 24.
- **Reminder:**
  - runs every 2 hours, 08:00–20:00 Colombo (cron `'30 2-14/2 * * *'` UTC)
  - one notice per reviewer per Colombo day (dedupe `review-late:<date>`)
  - title "N pieces of work waiting over 24 h" ("1 piece" for one); body "The oldest has waited 2 days." (or "30 hours" under 2 days)
  - links to `/admin/review?status=pending&month=<oldest's work month>`
- **Reviewers** are active people with **edit** access to the `review` page: main admins, admins whose `page_access->>'review'` is null or `'edit'`, and non-admins with `'edit'`.
  - An ordinary admin's own work isn't counted for them (they can't review it). Main admins' counts include everything.
- **Undo** uses the existing path: `reviewSubmissionsAction` with `decision: "pending"`. Nothing new reverses approvals. The DB still refuses changes in a closed pay month, and Undo then shows that error.
- **Copy:**
  - member pending: `"Waiting 30 h · reviews usually within 24 h"`
  - member approved: `"Rs 1,200 · on your November 2026 payslip"`
  - waiting text: under 1 h → `"under 1 h"`; under 48 h → `"30 h"`; otherwise `"3 d"`
- **No motion:** reviewing happens tens of times a day, and the rows change status rather than leave the list, so nothing animates.
- **No commits until "yes, push"**; one commit at the end under the owner's name, with no AI lines. The owner pastes migration 082.

## Review Focus

1. **Running the job twice in one day** gives each reviewer one notice, not two. *(Task 1 `once a day`)*
2. **An ordinary admin whose only waiting item is their own** gets no notice. *(Task 1 `own work not counted`)*
3. **Undo after the pay month was closed** in between: the toast shows the DB's refusal and the row stays approved. *(Task 3 browser check: look only)*
4. **Approving from the phone after the member edited the item** (`updated_at` changed): the existing "changed since you opened" error shows, and nothing is approved. *(Covered by the existing action; Task 3 check)*
5. **Sent-again work** waits from `resubmitted_at`, not the first submission. *(Task 1 `waiting starts again`, Task 2 `since`)*

---

### Task 1: Migration 082 and DB tests

**Files:** Create `supabase/migrations/20270103000082_review_limit.sql`; Test `tests/db/review-limit.test.ts`

**Interfaces (produces):**
- `alter table public.app_settings add column if not exists review_limit_hours integer not null default 24`, plus a check constraint `review_limit_hours between 1 and 168` (added only if missing).
- `review_limit_hours() returns integer`: stable, any signed-in user (granted to authenticated).
- `review_limit_set(p_hours integer) returns void`:
  - access: `is_admin() or has_page('review', true)`, else 42501
  - a value outside 1–168 or null gives P0001 "Pick between 1 and 168 hours."
  - writes activity `settings.review_limit`
- `review_waiting_summary() returns table (waiting integer, over_limit integer, oldest_at timestamptz, oldest_month date)`:
  - access: `has_page('review')`, else 42501
  - counts the same items the reminder counts for the caller (own work left out unless main admin)
- `send_review_late_notices() returns integer`: the number of reviewers notified. Not granted to authenticated; run by cron `review-late-notices`.

- [ ] **Step 1: Write the failing tests.**
  - **Setup:** a main admin, an ordinary admin A, a plain member; pending submissions inserted as owner with `created_at` set back in time (one 30 h old by the member, one 2 h old, and one 40 h old by A).
  - `access`: a plain member gets 42501 on `review_limit_set(12)` and on `review_waiting_summary()`; `review_limit_hours()` works for the plain member and returns 24.
  - `limit validated`: `review_limit_set(0)` and `(169)` give P0001; `(12)` then `review_limit_hours()` = 12 (then set it back to 24).
  - `summary`: for A, `waiting = 2` (own left out), `over_limit = 1`; for the main admin, `over_limit = 2`.
  - `once a day`: `send_review_late_notices()` twice gives exactly one `review.late` notice for A and one for the main admin, none for the plain member. A's title starts `"1 piece of work waiting over 24 h"`.
  - `own work not counted`: move the member's item to approved, so A's only late item is their own, and A gets no notice on a fresh day (clear A's notices first, or check the count is unchanged).
  - `waiting starts again`: a rejected item sent again with `resubmitted_at = now() - 1 h` and `created_at` 5 days old doesn't count as over the limit.
- [ ] **Step 2:** Run `PG_BIN=/opt/homebrew/bin LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx vitest run --config vitest.db.config.ts tests/db/review-limit.test.ts`. Expected: FAIL (functions missing).
- [ ] **Step 3:** Write the migration. The reviewer list and per-reviewer counts are one query; the summary and the job share a helper `review_late_items(p_viewer uuid)` (internal, not granted).
- [ ] **Step 4:** PASS, then the full `npm run test:db`.

### Task 2: Waiting helpers and unit tests

**Files:** Create `lib/review/waiting.ts`; Test `tests/unit/review-waiting.test.ts`

**Interfaces (produces):**
- `export function waitingSince(row: { created_at: string; resubmitted_at?: string | null }): string`
- `export function waitingHours(sinceIso: string, nowMs: number): number` (whole hours, rounded down)
- `export function waitingText(hours: number): string`: `"under 1 h"`, `"30 h"`, `"3 d"`
- `export function isOverLimit(hours: number, limit: number): boolean` (`hours >= limit`)

- [ ] **Step 1: Write the failing tests:**
  - `since`: resubmitted wins over created; null resubmitted falls back.
  - `hours`: 30 h 59 m → 30.
  - `text`: 0 → "under 1 h", 30 → "30 h", 47 → "47 h", 72 → "3 d".
  - `over limit`: 24 with limit 24 → true, 23 → false.
- [ ] **Step 2:** Run `npx vitest run tests/unit/review-waiting.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run `npx vitest run tests/unit && npm run typecheck`. Expected: PASS.

### Task 3: Phone review, the limit setting, and My work

**Files:**
- **`lib/actions/admin.ts`:**
  - `reviewSubmissionsAction` selects `id, updated_at` and returns `data: { count, items: { id, seen }[] }`, so Undo can send the new `seen`.
  - Add `setReviewLimitAction(hours: number)`: `adminCtx("review")`, a zod int 1–168, rpc `review_limit_set`, revalidates `/admin/review` and `/work`.
- **Create `components/admin/review-cards.tsx`:** client, `md:hidden`. Each pending card shows:
  - the title, member · role, qty and unit, the amount estimate, and the attachment count
  - a waiting chip ("Waiting 30 h", destructive tone when over the limit)
  - **Approve** (success, one tap) and **Send back**, which opens a Dialog with a required comment
  - Tapping the card body opens the existing `ReviewDialog`.
  - Decided cards show their status badge only.
- **Undo toast:** after Approve or Send back, `toast.success(message, { duration: 10_000, action: { label: "Undo", onClick } })`. `onClick` calls `reviewSubmissionsAction({ items: returned items, decision: "pending", comment: "" })`, toasts the result, and calls `router.refresh()`.
- **`components/admin/review-table.tsx`:** the table and bulk bar go in `hidden md:block`, with `<ReviewCards>` beside them; pending rows get the same waiting chip in the Status cell. It takes a `limitHours` prop.
- **`app/(app)/admin/review/page.tsx`:**
  - fetches `review_limit_hours()` and `review_waiting_summary()`
  - when `over_limit > 0`, shows an Alert "N waiting over 24 h · oldest 3 d" with a link to the oldest month's pending list
  - for editors, a small `ReviewLimitForm` (new, `components/admin/review-limit-form.tsx`): "Review within [24] hours", Save
- **`components/member/submission-card.tsx` and `app/(app)/work/page.tsx`:** the page fetches `review_limit_hours()` and passes `limitHours` plus the current time.
  - pending: the waiting line from the copy rules
  - approved with `showMoney`: the amount plus "on your <monthLabel(work_month)> payslip"
  - rejected: the comment box moves to just under the title
  - `MemberSubmission` gets `created_at` and `work_month` (already selected).
- **`lib/supabase/database.types.ts`:** the column and the four functions.

- [ ] **Step 1:** Implement it.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm test && npm run build`. Expected: all pass.
- [ ] **Step 3: Browser check (look only, no saves):**
  - Work review at phone width shows cards with Approve and Send back; desktop still shows the table.
  - The waiting chips and the over-limit line show (before 082 runs, the page must still load: the limit falls back to 24 and the summary is skipped).
  - My work shows the waiting line, the payslip month, and a rejected comment at the top.

### Task 4: Hand-off

- [ ] Give the owner migration 082.
- [ ] After "done", verify read-only: the column, the functions, the grants, and the cron job.
- [ ] Look at the pages again.
- [ ] On "yes, push", make one commit: `Review limit: daily reminders for work waiting too long, one-tap phone review with Undo, waiting time and payslip month on My work`.
