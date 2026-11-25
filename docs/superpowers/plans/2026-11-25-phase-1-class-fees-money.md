# Phase 1: Class fees and the Money page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Main admins set one monthly fee per class and see, for the last 6 months, income per class against staff pay, printing and postage.

**Architecture:**
- One migration (077) adds the `class_fees` table and five functions, all main-admin only except one internal helper.
- A pure TypeScript function joins the database rows with the staff pay that `getAnalytics` already works out.
- A new main-admin page `/admin/money` shows the table and a fee card.

**Tech Stack:** Next.js 16.4 App Router (Server Components, Server Actions), Supabase Postgres (RLS, `SECURITY DEFINER` functions), Zod, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-manager-tools-design.md` (section 5, Phase 1)

## Global Constraints

- **Branch:** `feature/money-page` from the latest `origin/main`.
- **Migration file:** `supabase/migrations/20261229000077_class_fees_money.sql`. It must be safe to run twice (`create … if not exists`, `create or replace`, `drop policy if exists`).
- **Every function:**
  - `language plpgsql` or `sql`, `security definer`, `set search_path = ''`.
  - `revoke all … from public, anon, authenticated`, then `grant execute … to authenticated` (except `class_fee_for`, which stays revoked).
  - Every `UPDATE` has a `WHERE`.
- **Access:** money is main admins only, checked with `public.is_main_admin()` in SQL and `getActionContext({ mainAdmin: true })` / `requireMainAdmin()` in the app.
- **Income rule** (spec): if the class-month's list has any amount, income = sum of amounts. Otherwise income = max(paid − Free enrollment rows, 0) × fee. Paid = `public.class_paid_count(class, month)`. It is labelled an estimate.
- **Costs:**
  - Printing: `tute_print_jobs.cost`, where status ≠ `cancelled` and cost is not null, in the Colombo month of `coalesce(received_at, created_at)`.
  - Postage: `post_rounds.receipt_total`, where status ≠ `cancelled`, by `post_rounds.month`.
  - Staff pay: `getAnalytics(supabase, month, 6).months[].spent`. A month counts as closed when it's in `getClosedMonthKeys`.
- **Money formatting:** `formatLKR` from `lib/core/format`. Months use the keys from `lib/core/month` (`"YYYY-MM"`).
- **Read first:** before writing the page, read `node_modules/next/dist/docs/` on App Router pages and `loading.tsx` (the repo's AGENTS.md requires it).
- **UI:** no coloured left-border strips. Motion only via existing components (StatCard already animates), and none when reduced motion is set.
- **Git:**
  - Identity: `Hemal Pramuditha <206418743+hemalkph@users.noreply.github.com>`.
  - **No commits until the owner says "yes, push"**, and no AI attribution lines. The "Commit" points below mean "leave the files staged-ready". The single commit happens at the end.
- **Database:** the owner pastes the migration into the Supabase SQL Editor. After they say "done", verify with read-only queries.

## Review Focus

1. **A class with no fee:** its income shows as "Set a fee", never Rs 0. Profit still adds up the classes that have a fee, and the page says how many classes are missing one. *(Task 1 test `no fee gives no_fee`; Task 2 test `missing fee is not counted as zero`)*
2. **A fee changed from a later month:** earlier months keep the old fee; the changed month and later use the new one. *(Task 1 test `fee from_month applies forward`)*
3. **A month with a typed count but no list:** free = 0 and income = typed count × fee. *(Task 1 test `typed count without list`)*
4. **More Free enrollment rows than the paid count** (a typed count lower than the list): income is never negative. *(Task 1 test `never negative`)*
5. **An ordinary admin or a member** calls the money functions directly: refused with 42501. *(Task 1 test `only main admins`)*

---

### Task 1: Migration 077 and its DB tests

**Files:**
- Create: `supabase/migrations/20261229000077_class_fees_money.sql`
- Test: `tests/db/money.test.ts`

**Interfaces:**
- Consumes: `public.class_paid_count(p_class uuid, p_month date) returns integer`, `public.is_main_admin()`, `public.write_activity(...)` (same call shape as in `20261227000075_class_ops_polish.sql`), tables `fee_classes`, `batches`, `fee_month_students`, `tute_print_jobs`, `post_rounds`.
- Produces:
  - `public.class_fees (class_id uuid → fee_classes on delete cascade, from_month date check day = 1, monthly_fee numeric(10,2) not null check 0..10000000, updated_by uuid → profiles on delete set null, updated_at timestamptz not null default now(), primary key (class_id, from_month))`. RLS on, with no policies (functions only).
  - `public.class_fee_for(p_class uuid, p_month date) returns numeric`: the fee of the latest `from_month ≤ date_trunc('month', p_month)`, or null. Internal: not granted to authenticated. Phase 2 uses it.
  - `public.class_fee_set(p_class uuid, p_from_month date, p_fee numeric) returns void`: main admins only.
    - Errors: "Class not found." and "Fee must be between 0 and 10,000,000." (P0001).
    - Upserts on `(class_id, date_trunc('month', p_from_month))` and writes activity `class.fee_set`.
  - `public.class_fee_list() returns table (class_id uuid, class_name text, batch_name text, is_active boolean, fee numeric, from_month date)`: main admins only. Every class, with the fee and `from_month` in force this Colombo month (both null if none), ordered by batch `sort_order`, then class name.
  - `public.money_income(p_from date, p_to date) returns table (class_id uuid, class_name text, batch_name text, month date, fee numeric, paid integer, free integer, amount_total numeric, income numeric, income_source text)`: main admins only.
    - One row per month in `[p_from, p_to]` (truncated to months, at most 24 months, else P0001 "Choose at most 24 months.") for each class that is active or has a list or count in that range.
    - `income_source` is one of `amounts`, `fee`, `no_fee` (fee null; income null), `no_count` (paid null; income null).
  - `public.money_costs(p_from date, p_to date) returns table (month date, printing numeric, postage numeric)`: main admins only. One row for every month in the range, with zeros when nothing was spent.

- [ ] **Step 1: Write the failing tests** in `tests/db/money.test.ts`, following the setup in `tests/db/class-ops.test.ts` (`session`, `createPerson({ mainAdmin: true })`, `createPerson({ admin: true })`, `createPerson({ pageAccess: { class_ops: "edit" } })`, `createBatch`, `actAs`, `asOwner`, `outcome`). Create one class with `fee_class_save` as the main admin. Tests:
  - `only main admins`: as an ordinary admin and as a class_ops editor, `outcome(...)` of `class_fee_set`, `class_fee_list()`, `money_income(...)` and `money_costs(...)` each equals `"42501"`; `select public.class_fee_for(...)` as the main admin also gives `"42501"` (not granted).
  - `fee from_month applies forward`: set 1000 from 2026-09-01, then 1500 from 2026-11-01; `money_income('2026-09-01','2026-12-01')` gives fee 1000 for Sep and Oct, and 1500 for Nov and Dec. Saving 1500 from 2026-11-01 again leaves one row in `class_fees` for that month.
  - `income from fee`: as owner, insert 3 `fee_month_students` rows for Nov (one with `export_label = 'Free enrollment'`) plus a `fee_month_imports` row with `unique_student_count = 3`. The Nov row has `paid = 3`, `free = 1`, `income = 3000` (2 × 1500), `income_source = 'fee'`.
  - `income from amounts`: give two Oct rows `amount = 1200` and `800`. The Oct row has `income = 2000`, `income_source = 'amounts'`.
  - `typed count without list`: `class_paid_count_save(class, 7)` this month as a class_ops editor, with no list this month. This month's row has `free = 0` and `income = 7 × fee`.
  - `never negative`: on a second class with a fee, for this month (typed counts only go to the current month), upload a list holding 2 Free enrollment rows, then type a count of 1. This month's row gives `income = 0`.
  - `no fee gives no_fee`: a second class with a count but no fee has `income` null and `income_source = 'no_fee'`.
  - `costs by month`:
    - Print jobs: Rs 5000 received in Nov, Rs 999 cancelled, and one with cost null.
    - A post round for Nov with `receipt_total = 2400`, and one cancelled with 9999.
    - `money_costs('2026-10-01','2026-11-01')` gives Oct `{printing: 0, postage: 0}` and Nov `{printing: 5000, postage: 2400}`.
  - `range limit`: `money_income('2024-01-01','2026-12-01')` gives `"P0001"`.
  - `safe to run twice`: covered by the harness, which applies all migrations twice. No separate test.

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `PG_BIN=/opt/homebrew/bin LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx vitest run tests/db/money.test.ts`
Expected: FAIL with `function public.class_fee_set(...) does not exist`.

- [ ] **Step 3: Write migration 077** with the table, the five functions and grants exactly as in **Interfaces**. Two `money_income` details:
  - Free = `count(*) filter (where export_label = 'Free enrollment')` from `fee_month_students` for the class-month.
  - `amount_total` = `sum(amount)`, and the `amounts` source applies when `count(amount) > 0`.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: the same command. Expected: all `money.test.ts` tests PASS. Then run the full `npm run test:db` (with the same environment variables); expected: no other test file fails.

- [ ] **Step 5: Ready to commit** (no commit yet; see Global Constraints).

---

### Task 2: Types, query layer, validation and action

**Files:**
- Modify: `lib/supabase/database.types.ts` (Functions: add the four granted functions, next to `class_paid_count_save`)
- Modify: `lib/core/validation.ts` (add `classFeeSchema`, `ClassFeeInput`)
- Create: `lib/money/queries.ts`
- Create: `lib/actions/money.ts`
- Test: `tests/unit/money.test.ts`

**Interfaces:**
- Consumes: the Task 1 functions, `getAnalytics(supabase, month, 6)` → `AnalyticsData.months: MonthSpend[]` (`{ key, month, spent, pending }`), `getClosedMonthKeys(supabase): Promise<string[]>`, `monthKeyToDate`, `shiftMonth`, `monthLabel`, `ActionResult` from `lib/core/action-result`, `getActionContext`, `NOT_ALLOWED`.
- Produces:
  - `export type IncomeSource = "amounts" | "fee" | "no_fee" | "no_count"`
  - `export type MoneyClassCell = { classId: string; name: string; batch: string; fee: number | null; paid: number | null; free: number; income: number | null; source: IncomeSource }`
  - `export type MoneyMonth = { key: string; label: string; classes: MoneyClassCell[]; income: number; staff: number; staffClosed: boolean; printing: number; postage: number; profit: number; missingFees: number }`
  - `export type ClassFeeRow = { classId: string; name: string; batch: string; isActive: boolean; fee: number | null; fromMonth: string | null }`
  - `export function buildMoneyMonths(keys: string[], income: IncomeRow[], costs: CostRow[], staff: MonthSpend[], closedKeys: string[]): MoneyMonth[]`, where `IncomeRow = Database["public"]["Functions"]["money_income"]["Returns"][number]` and `CostRow = Database["public"]["Functions"]["money_costs"]["Returns"][number]`.
  - `export async function getMoneyPage(supabase: SupabaseClient<Database>, month: string): Promise<{ months: MoneyMonth[]; fees: ClassFeeRow[] }>`: the 6 months ending at `month`, oldest first.
  - `export const classFeeSchema = z.object({ class_id: z.string().uuid(), from_month: monthKey, fee: z.coerce.number().min(0).max(10_000_000) })` and `export type ClassFeeInput = z.infer<typeof classFeeSchema>`
  - `export async function setClassFeeAction(input: ClassFeeInput): Promise<ActionResult>`, in `lib/actions/money.ts` (`"use server"`). It returns the message `Fee saved from <Month YYYY>.` and calls `revalidatePath("/admin/money")`.

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/money.test.ts` for `buildMoneyMonths`, using plain objects:
  - `missing fee is not counted as zero`: a `no_fee` class plus a `fee` class with income 3000 gives month `income = 3000` and `missingFees = 1`.
  - `profit is income minus staff, printing and postage`: income 10000, staff 4000, printing 1500, postage 500 gives `profit = 4000`.
  - `staffClosed follows closed months`: `closedKeys = ["2026-10"]` gives Oct `staffClosed = true` and Nov `false`.
  - `months with no rows still appear`: `keys` of 6 months and an empty `income` give 6 months with `income = 0`.

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `npx vitest run tests/unit/money.test.ts`
Expected: FAIL with `Cannot find module '@/lib/money/queries'`.

- [ ] **Step 3: Implement** `buildMoneyMonths` and `getMoneyPage` in `lib/money/queries.ts`.
  - `getMoneyPage` runs the three reads in parallel: `rpc("money_income")`, `rpc("money_costs")` and `rpc("class_fee_list")`, plus `getAnalytics` and `getClosedMonthKeys`.
  - Add the types to `database.types.ts`, the schema to `validation.ts`, and `setClassFeeAction` (`getActionContext({ mainAdmin: true })`, `safeParse`, `rpc("class_fee_set", { p_class, p_from_month: monthKeyToDate(from_month), p_fee })`). It maps errors the same way `lib/actions/class-ops.ts` does.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run tests/unit/money.test.ts && npm run typecheck`
Expected: PASS, and no type errors.

- [ ] **Step 5: Ready to commit.**

---

### Task 3: The Money page

**Files:**
- Modify: `lib/auth/page-access.ts`:
  - Add `"money"` to `PageKey`.
  - Add `{ key: "money", title: "Money", href: "/admin/money", mainOnly: true }` after `analytics` in `PAGES`.
- Modify: `lib/auth/navigation.ts`: add an `ADMIN_NAV` entry after Analytics: `{ page: "money", title: "Money", href: "/admin/money", icon: WalletIcon, keywords: "income fees profit costs classes", section: "Overview" }`.
- Create: `app/(app)/admin/money/page.tsx` and `app/(app)/admin/money/loading.tsx`
- Create: `components/money/money-table.tsx` and `components/money/class-fees-card.tsx`

**Interfaces:**
- Consumes: `requireMainAdmin()`, `getMoneyPage`, `setClassFeeAction`, `MoneyMonth`, `ClassFeeRow`, `MonthSelect`, `PageHeader`, `StatCard`, `Table*`, `Dialog*`, `formatLKR`, `monthLabel`.
- Produces: the route `/admin/money` (main admins only; everyone else is redirected by `requireMainAdmin`).

**Page layout** (top to bottom):
- `PageHeader` with the title "Money" and the description "Income from class fees against staff pay, printing and postage. Income is an estimate: paid students × the class fee."
- A `MonthSelect` (default: this month).
- A row of 4 `StatCard`s for the chosen month: Income, Costs (staff + printing + postage), Profit, and "Classes without a fee" (shown only when > 0).
- **`MoneyTable`:**
  - Columns: the 6 months, oldest first.
  - Rows: one per class (income, or the text "Set a fee", or "No count"), then Total income, Staff pay (with an "estimate" tag when not closed), Printing, Postage and Profit.
  - On phones, the table scrolls sideways with the first column fixed.
- **`ClassFeesCard`:** a list of classes with their fee and "from" month, and an Edit button. The Edit button opens a dialog: fee (number), from month (`MonthSelect`, default this month), and Save, which calls `setClassFeeAction` and toasts the result.

- [ ] **Step 1: Read the Next.js docs** for App Router pages and loading UI in `node_modules/next/dist/docs/`. Note any change from `app/(app)/admin/analytics/page.tsx` (`searchParams` as a Promise, and so on).

- [ ] **Step 2: Implement** the access entries, page, loading skeleton (copy the shape of `app/(app)/admin/analytics/loading.tsx`) and both components.

- [ ] **Step 3: Check**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass. The build lists `/admin/money`.

- [ ] **Step 4: Look in the browser** (the owner's dev server on localhost:3000; look only, save nothing).
  - Signed in as a main admin, `/admin/money` shows the table. Every class shows "Set a fee" until the owner runs 077 and enters fees, and the sidebar shows Money under Overview.
  - Before 077 is run, the page must show a clear error card instead of crashing. Wrap the RPC errors in `getMoneyPage` into an `error` string, shown with `EmptyState`.

- [ ] **Step 5: Ready to commit.**

---

### Task 4: Hand-off

- [ ] **Step 1:** Give the owner the contents of `supabase/migrations/20261229000077_class_fees_money.sql` to paste into the SQL Editor.
- [ ] **Step 2:** After "done", verify read-only:
  - `class_fees` exists with RLS on.
  - `class_fee_set`, `class_fee_list`, `money_income` and `money_costs` exist with execute granted to authenticated.
  - `class_fee_for` is not granted to authenticated.
  - `has_table_privilege('authenticated','public.class_fees','select')` is false.
- [ ] **Step 3:** On "yes, push": one commit `Money page: class fees and monthly income against costs (main admins)` with the plan, the design doc, the migration, the tests and the app files, then push `feature/money-page`.
