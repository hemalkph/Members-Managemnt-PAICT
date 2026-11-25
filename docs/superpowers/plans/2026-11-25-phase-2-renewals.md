# Phase 2: Renewals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For each class, show how many of last month's students have renewed against the target. Give every unpaid student an outcome, give a named person a call list, and show main admins the money at risk.

**Architecture:**
- **Migration 078:**
  - Extends follow-ups with outcomes and calls.
  - Adds a call owner per class.
  - Stores one renewal snapshot per class per day.
  - Sends daily notices from pg_cron.
- **Matching:** the existing three-pass match in `lib/fees/compare.ts` stays the only way students are matched. After each upload (and the first time the page opens a month), the app records the snapshot and tells the database which follow-ups are still due. That lets the SQL notices skip students who have paid.
- **UI:** a new route, `/admin/fee-reminders/renewals`, with the same page access as Fee reminders.

**Tech Stack:** Next.js 16.4 App Router, Supabase Postgres (RLS, `SECURITY DEFINER`, pg_cron), Zod, shadcn/ui, recharts (`components/ui/chart.tsx`), motion, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-manager-tools-design.md` (section 5, Phase 2; answers in section 7)

## Global Constraints

- **Branch:** `feature/renewals` from `origin/main` (already created).
- **Migration file:** `supabase/migrations/20261230000078_renewals.sql`. It must be safe to run twice.
- **Functions:**
  - `security definer`, `set search_path = ''`.
  - `revoke all … from public, anon, authenticated`, then grant to authenticated only where stated.
  - Every `UPDATE` has a `WHERE`.
- **Access:** `has_page('fee_reminders')` to read, `has_page('fee_reminders', true)` to write. Money at risk only for main admins: the page calls `class_fee_list()` only when `profile.is_main_admin`.
- **Target:** 90% of last month's students by the 10th. Defaults are `app_settings.renewal_due_day = 10` and `renewal_target_pct = 90`; Fee reminders editors can change them.
- **Call rule** (the same in SQL and TS). A follow-up needs a call when it is not paid (`paid_seen_at is null`) and either:
  - `status = 'messaged'`, `message_count >= 2`, `last_messaged_at <= now() - 2 days`, and no call in the last day (`last_called_at is null or <= now() - 1 day`); or
  - `status = 'promised'`, `promised_by < today` (Colombo), and no call in the last day.
- **Statuses:**
  - Closed (no more chasing): `excused`, `dropped`, `cant_afford`, `moved_class`.
  - Chasing: `messaged`, `promised`.
  - Not started: `pending`.
- **Dropped reasons (codes → labels):** `exams` Exams, `money` Money, `moved_away` Moved away, `timing` Class time, `other_institute` Another institute, `other` Other.
- **Daily notices:** 09:00 Colombo (`'30 3 * * *'` UTC), job name `renewal-notices`, at most one per class per person per day (dedupe keys below).
- **UI:** no coloured left-border strips. Motion is 150–250 ms and off under `prefers-reduced-motion`. Read `node_modules/next/dist/docs/` for any route API you use. Load the `dataviz` skill before the chart and the `animate` skill before the call-list motion.
- **Git:** no commits until the owner says "yes, push"; one commit at the end, under the owner's name, with no AI lines.

## Review Focus

1. **A student who pays after reminders:** after the next upload they are off the call list, out of the notices and out of the money at risk. *(Task 1 `record marks paid follow-ups`, Task 2 `paid student never needs a call`)*
2. **Two uploads on the same day:** one snapshot for that day, holding the latest numbers. *(Task 1 `one snapshot per day`)*
3. **A promise that passes unpaid:** the student comes back on the call list the next day. A date in the past can't be saved. *(Task 1 `promised needs a future date`, Task 2 `passed promise needs a call`)*
4. **A class with no previous-month list:** the card says so and shows no %, and there is no division by zero. *(Task 2 `no previous list`)*
5. **Money hidden from others:** a non-main admin never gets rupees, because fees aren't loaded for them. *(Task 3 code step and Task 4 browser check)*

---

### Task 1: Migration 078 and DB tests

**Files:**
- Create: `supabase/migrations/20261230000078_renewals.sql`
- Test: `tests/db/renewals.test.ts`

**Interfaces:**
- Consumes: `has_page`, `people_with_page(text) returns setof uuid`, `notify(user, kind, title, body, link, dedupe)`, `write_activity(...)`, `fee_followup_set` (from 061; same 11-argument signature).
- Produces:
  - `fee_classes.followup_owner_id uuid` → profiles `on delete set null`.
  - `fee_due_followups`:
    - The status check is replaced (`drop constraint if exists fee_due_followups_status_check`) with the 7 statuses.
    - New columns:
      - `promised_by date`
      - `reason text not null default ''` (≤ 40)
      - `moved_to_class uuid` → fee_classes `on delete set null`
      - `call_count int not null default 0 ≥ 0`
      - `last_called_at timestamptz`
      - `last_called_by uuid` → profiles `on delete set null`
      - `paid_seen_at timestamptz`
  - `fee_followup_set`: body re-created with the same signature, so its status check accepts all 7 statuses.
  - `app_settings.renewal_due_day smallint not null default 10 check 1..28` and `renewal_target_pct smallint not null default 90 check 1..100`.
  - `fee_renewal_snapshots (class_id → fee_classes on delete cascade, month date (day 1), day date, prev_total int ≥ 0, renewed int ≥ 0, new_students int ≥ 0, taken_at timestamptz default now(), primary key (class_id, month, day))`. RLS on, everything revoked.
  - `fee_class_owner_set(p_class uuid, p_owner uuid) returns void`.
    - Access: `has_page('fee_reminders', true)` or `has_page('class_ops', true)`.
    - A null owner clears it. Otherwise the owner must be in `people_with_page('fee_reminders')`, else P0001 "Pick someone who can open Fee reminders."
    - Writes activity `fee.call_owner_set`.
  - `fee_followup_outcome(p_class_id uuid, p_due_month date, p_student_key text, p_student_name text, p_whatsapp_norm text, p_outcome text, p_promised_by date default null, p_reason text default null, p_moved_to uuid default null, p_note text default null, p_called boolean default true) returns public.fee_due_followups`.
    - Access: Fee reminders edit.
    - `p_outcome ∈ {no_answer, promised, cant_afford, moved_class, dropped, excused}`, else P0001 "Unknown outcome."
    - `promised` needs today ≤ `p_promised_by` ≤ today + 45 days, else P0001 "Pick the date they promised to pay."
    - `dropped` needs a reason code from the list, else P0001 "Pick why they left."
    - `moved_class` needs an existing class other than `p_class_id`, else P0001 "Pick the class they moved to."
    - It upserts on `(class_id, due_month, student_key)`:
      - status = the outcome, except `no_answer`, which keeps the existing status (or `pending` for a new row);
      - `promised_by`, `reason` and `moved_to_class` are set for their own outcome;
      - when `p_called`: `call_count + 1`, `last_called_at = now()`, `last_called_by = actor`;
      - note only when given;
      - `updated_by`, `updated_at`.
  - `fee_renewal_record(p_class uuid, p_month date, p_prev_total int, p_renewed int, p_new int, p_due_keys text[]) returns void`.
    - Access: `has_page('fee_reminders')`. View is enough, because it only stores numbers worked out from the lists.
    - Counts below 0 give P0001.
    - If `date_trunc('month', p_month)` is the current Colombo month, it upserts the snapshot for today's Colombo date.
    - Always: for that class and due month, `paid_seen_at = null` where `student_key = any(p_due_keys)`, else `coalesce(paid_seen_at, now())`.
  - `fee_renewal_history(p_month date) returns table (class_id uuid, day date, prev_total int, renewed int, new_students int)`: `has_page('fee_reminders')`, ordered by class, then day.
  - `fee_renewal_settings() returns table (due_day int, target_pct int)` with `has_page('fee_reminders')`. `fee_renewal_settings_set(p_due_day int, p_target_pct int) returns void` with Fee reminders edit; errors P0001 "Pick a day from 1 to 28." and "Pick a share from 1 to 100%."
  - `followup_needs_call(f public.fee_due_followups, p_today date) returns boolean`: the call rule (Global Constraints). Internal: not granted.
  - `send_renewal_notices() returns integer`. Internal: not granted; pg_cron runs it. For each class, in the current Colombo month:
    - **Calls:** n = follow-ups where `followup_needs_call`. If n > 0, the class owner (if set and active) is notified, otherwise everyone in `people_with_page('fee_reminders')`.
      - Kind `fee.calls_due`, title `"<n> students to call for <class>"`.
      - Body `"They had 2 reminders and haven't paid. Note what each one says."`
      - Link `/admin/fee-reminders/renewals`, dedupe `fee-calls:<class_id>:<today>`.
    - **Can't afford:** m = follow-ups with `status = 'cant_afford'` and `updated_at >= now() - 1 day`. If m > 0, everyone in `people_with_page('students')` is notified.
      - Kind `fee.cant_afford`, title `"<m> students in <class> say they can't afford the fee"`.
      - Link `/admin/fee-reminders/renewals`, dedupe `fee-cant-afford:<class_id>:<today>`.
    - It returns the number of notify calls.
  - `cron.schedule('renewal-notices', '30 3 * * *', $$ select public.send_renewal_notices(); $$)`.

- [ ] **Step 1: Write the failing tests** in `tests/db/renewals.test.ts`.
  - **Setup** (same helpers as `tests/db/money.test.ts`):
    - Actors: an admin; a Fee reminders editor; a Fee reminders viewer; a Students-page viewer; someone with no access.
    - Two classes, A and B, in one batch.
    - `M` = the current Colombo month; `TODAY` = the Colombo date.
  - **Tests:**
    - `access`:
      - The viewer gets `42501` from `fee_followup_outcome`, `fee_class_owner_set` and `fee_renewal_settings_set`, but `ok` from `fee_renewal_record`, `fee_renewal_history` and `fee_renewal_settings`.
      - The no-access person gets `42501` from `fee_renewal_history`.
      - Anyone signed in gets `42501` from `send_renewal_notices()` and `followup_needs_call`.
    - `promised needs a future date`:
      - `promised` with yesterday gives `P0001`.
      - With today + 3 it sets `status = 'promised'`, `promised_by` and `call_count = 1`.
    - `outcome rules`:
      - `dropped` with no reason gives `P0001`; with `money` it sets `reason = 'money'`.
      - `moved_class` to A from A gives `P0001`; to B it sets `moved_to_class = B`.
      - `no_answer` on a `messaged` row keeps `messaged` and adds 1 to `call_count`.
      - `p_called = false` leaves `call_count` unchanged.
    - `old dialog still saves new statuses`: `fee_followup_set(…, 'promised', …)` on an existing promised row is `ok`.
    - `one snapshot per day`: `fee_renewal_record(A, M, 10, 4, 1, '{}')`, then `(A, M, 10, 6, 2, '{}')` leaves one row for A today, with `renewed = 6` and `new_students = 2`.
    - `record marks paid follow-ups`: with follow-ups k1 and k2 in A/M, `fee_renewal_record(A, M, 10, 6, 2, array['k2'])` sets k1's `paid_seen_at` and leaves k2's null. Recording again with `array['k1','k2']` sets both back to null.
    - `past month records no snapshot`: `fee_renewal_record(A, M - 1 month, …)` adds no snapshot row.
    - `call notices`:
      - As owner, set k2 to `messaged`, `message_count = 2`, `last_messaged_at = now() - 3 days`. Then `send_renewal_notices()` gives one `fee.calls_due` notification to the A owner (set by `fee_class_owner_set` to the editor) and none to the viewer.
      - Running it again the same day adds none.
      - Clearing the owner sends it to the viewer as well.
      - After k2's `paid_seen_at` is set, no notice.
    - `cant afford notice`: k3 set to `cant_afford` today gives the Students-page viewer one `fee.cant_afford`.
    - `settings`: defaults are `{due_day: 10, target_pct: 90}`; setting `(15, 80)` gives `{15, 80}`; `(0, 80)` and `(10, 120)` give `P0001`.
    - `owner must have access`: `fee_class_owner_set(A, noAccessPerson)` gives `P0001`.

- [ ] **Step 2: Run them to see them fail**

Run: `PG_BIN=/opt/homebrew/bin LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx vitest run --config vitest.db.config.ts tests/db/renewals.test.ts`
Expected: FAIL, because the functions don't exist.

- [ ] **Step 3: Write migration 078** exactly as in **Interfaces**. Copy `fee_followup_set` from `20261213000061_fee_reminders.sql`, changing only its status list.

- [ ] **Step 4: Run the tests to see them pass**

Run: the same command. Expected: all PASS. Then run the full `npm run test:db` (with the same variables). Expected: no other file fails.

---

### Task 2: Renewal rules in TypeScript, with unit tests

**Files:**
- Create: `lib/fees/renewals.ts`
- Modify:
  - `lib/fees/compare.ts`: `FollowupRecord` gets optional `promisedBy`, `reason`, `movedToClassId`, `callCount`, `lastCalledAt` and `paidSeenAt`. `ComparedStudent` gets the same fields as required, with null or 0 on paid and new rows. Due rows copy them from the follow-up. `kindRank` puts `promised` with messaged (2) and closed statuses at 4.
  - `lib/supabase/database.types.ts`: `FeeFollowupStatus` adds `"promised" | "cant_afford" | "moved_class"`. Add the new columns to the `fee_due_followups` Row, `followup_owner_id` to `fee_classes`, and the granted functions.
- Test: `tests/unit/renewals.test.ts`

**Interfaces:**
- Produces, in `lib/fees/renewals.ts`:
  - `export const CLOSED_STATUSES: FeeFollowupStatus[]` and `export function isClosedFollowup(s: FeeFollowupStatus): boolean`
  - `export const DROP_REASONS: { code: DropReason; label: string }[]` and `export type DropReason = "exams" | "money" | "moved_away" | "timing" | "other_institute" | "other"`
  - `export function needsCall(row: Pick<ComparedStudent, "kind" | "followupStatus" | "messageCount" | "lastMessagedAt" | "lastCalledAt" | "promisedBy">, now: Date, today: string): boolean`: the call rule. `kind !== "due"` is false (paid students are never called).
  - `export function targetShare(day: number, dueDay: number, targetPct: number): number`: day ≥ dueDay gives targetPct; otherwise `targetPct × (day − 1) / (dueDay − 1)` (and targetPct when dueDay = 1).
  - `export function findMovedClass(student: Pick<ComparedStudent, "fullName" | "whatsappNorm" | "mobileNorm">, others: { classId: string; className: string; students: MonthStudentRow[] }[]): { classId: string; className: string } | null`: a phone match (WhatsApp or Mobile, either way) with `areNamesCompatible`, otherwise an exact normalised name of at least 5 characters.
  - `export type RenewalCard = { classId: string; className: string; batchName: string; prevTotal: number; renewed: number; renewedPct: number | null; fresh: number; unpaid: number; open: number; outcomes: Partial<Record<FeeFollowupStatus, number>>; callList: ComparedStudent[]; moneyAtRisk: number | null }`
  - `export function buildRenewalCard(input: { classId: string; className: string; batchName: string; result: FeeComparisonResult; fee: number | null; now: Date; today: string }): RenewalCard`:
    - `renewedPct` is null when `prevTotal = 0`.
    - `open` = unpaid that isn't closed.
    - `moneyAtRisk` = open × fee, or null without a fee.
    - `callList` = due rows where `needsCall`, the oldest last message first.

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/renewals.test.ts`, using fixed `now = new Date("2026-11-25T09:00:00+05:30")` and `today = "2026-11-25"`:
  - `paid student never needs a call`: a `kind: "paid"` row with `messageCount` 5 gives false.
  - `two messages and two days`:
    - messaged ×2, last message 2026-11-22 10:00, no call: true.
    - Last message 2026-11-24: false.
    - messaged ×1: false.
    - Last call 2026-11-24 20:00: false. Last call 2026-11-24 08:00: true.
  - `passed promise needs a call`: promised by 2026-11-24 gives true; promised by 2026-11-25 gives false.
  - `closed statuses never need a call`: each of `excused`, `dropped`, `cant_afford` and `moved_class` with messages ×3 gives false.
  - `target line`: `targetShare(1,10,90)=0`, `targetShare(10,10,90)=90`, `targetShare(20,10,90)=90`, `targetShare(5,10,90)=40`, `targetShare(1,1,90)=90`.
  - `moved class by phone or name`:
    - The student's mobile equals the other class's WhatsApp, with a compatible name: returns that class.
    - Same phone but an incompatible name: null.
    - Exact name "Nimal Perera" with no phone: returns the class.
    - Name "Ann": null.
  - `card numbers`:
    - prev 10, 6 renewed, 2 new; 4 due: one `excused`, one `promised` (future), two `messaged` ×2 three days ago.
    - Fee 3000 gives `renewedPct = 60`, `unpaid = 4`, `open = 3`, `moneyAtRisk = 9000`, and `callList.length = 2`.
    - Fee null gives `moneyAtRisk = null`.
  - `no previous list`: `prevTotal = 0` gives `renewedPct = null`, with no throw.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/renewals.test.ts`. Expected: FAIL, because the module can't be found.

- [ ] **Step 3: Implement** `lib/fees/renewals.ts` and the `compare.ts` / types changes.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/unit && npm run typecheck`. Expected: all PASS, including the existing `fees-parse-compare.test.ts`, and no type errors.

---

### Task 3: Queries, actions and the upload hook

**Files:**
- Modify: `lib/fees/queries.ts` (`getClassComparisonData` maps the new follow-up columns)
- Create: `lib/fees/renewals-queries.ts` (server-only)
- Create: `lib/actions/renewals.ts`
- Modify: `lib/core/validation.ts`: `followupOutcomeSchema`, `callOwnerSchema` and `renewalSettingsSchema`
- Modify: `lib/actions/fees.ts` (`importFeeMonthAction` records renewals after a successful import)

**Interfaces:**
- Consumes: the Task 1 RPCs, plus Task 2 `buildRenewalCard`, `findMovedClass`, `compareClassMonths` and `getClassComparisonData`.
- Produces:
  - `export async function recordRenewal(supabase, cls: { id: string; batchId: string }, month: string): Promise<void>`, in `renewals-queries.ts`.
    - It loads the comparison (previous month = `shiftMonth(month, -1)`) and calls `fee_renewal_record` with `prevCount`, `paidBothCount`, `newCount` and the due rows' `studentKey`s.
    - Errors are logged, never thrown: an upload never fails because of renewals.
  - `export type RenewalsPage = { month: string; cards: (RenewalCard & { ownerId: string | null; history: { day: string; renewedPct: number }[]; moved: Record<string, { classId: string; className: string }> })[]; settings: { dueDay: number; targetPct: number }; team: { id: string; name: string }[]; showMoney: boolean }`
  - `export async function getRenewalsPage(supabase, month: string, showMoney: boolean): Promise<RenewalsPage>`:
    - Classes: active ones, plus any with a list in `month`.
    - Calls `recordRenewal` once for a class-month that has no snapshot yet (current month only).
    - `class_fee_list()` only when `showMoney`.
    - `moved` maps a due studentKey to the suggested class, for open rows only.
  - **Actions** (`"use server"`, `getActionContext({ page: "fee_reminders", edit: true })`; each one `revalidatePath("/admin/fee-reminders/renewals")` and `"/admin/fee-reminders"`):
    - `setFollowupOutcomeAction(input: FollowupOutcomeInput): Promise<ActionResult>`
    - `setCallOwnerAction(input: CallOwnerInput): Promise<ActionResult>`
    - `saveRenewalSettingsAction(input: RenewalSettingsInput): Promise<ActionResult>`
  - **Schemas:**
    - `followupOutcomeSchema = z.object({ class_id: uuid, due_month: monthKey, student_key: z.string().min(2).max(200), student_name: z.string().max(150), whatsapp_norm: z.string().regex(/^[0-9]{9,15}$/).nullable(), outcome: z.enum(["no_answer","promised","cant_afford","moved_class","dropped","excused"]), promised_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), reason: z.enum([...DropReason]).nullable().optional(), moved_to: uuid.nullable().optional(), note: z.string().max(500).optional(), called: z.boolean().default(true) })`
    - `callOwnerSchema = z.object({ class_id: uuid, owner_id: uuid.nullable() })`
    - `renewalSettingsSchema = z.object({ due_day: z.coerce.number().int().min(1).max(28), target_pct: z.coerce.number().int().min(1).max(100) })`

- [ ] **Step 1:** Implement the query mapping, `recordRenewal`, `getRenewalsPage`, the schemas and the actions. In `importFeeMonthAction`, after each group imports without error and the month equals `todayISO().slice(0, 7)`, `await recordRenewal(...)` for that class.

- [ ] **Step 2: Check**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit`
Expected: all PASS.

---

### Task 4: The Renewals page

**Files:**
- Create: `app/(app)/admin/fee-reminders/renewals/page.tsx` and `loading.tsx` (`requirePage("fee_reminders")`, month = Colombo calendar month, `MonthSelect calendar`)
- Create: `components/fees/renewals/renewal-card.tsx`, `renewal-chart.tsx`, `call-list.tsx`, `outcome-dialog.tsx` and `renewal-settings.tsx`
- Modify: `components/fees/fee-workspace.tsx`:
  - A "Renewals" link button visible to everyone with page access (outside `canEdit`).
  - `STATUS_META` gains `promised` "Promised to pay" (warning), `cant_afford` "Can't afford" (secondary) and `moved_class` "Moved class" (outline).
  - Counts and the `excused_dropped` bucket use `isClosedFollowup`; `promised` counts as messaged.
- Modify: `components/fees/whatsapp-queue-dialog.tsx`: skips `isClosedFollowup` rows (in place of the excused/dropped checks).
- Modify: `components/fees/followup-dialog.tsx`: the Select also lists the row's current status when it's one of the three new ones, so saving keeps it.
- Modify: `components/notifications/notification-item.tsx`: META gets `fee.calls_due` (PhoneCallIcon) and `fee.cant_afford` (HandCoinsIcon).

**Page layout:**
- `PageHeader` "Renewals" (description: "Last month's students who have paid this month, against the target of {target}% by the {dueDay}th."). Actions: `MonthSelect calendar`, a "Fee reminders" back link, and the settings popover for editors.
- **One `RenewalCard` per class:**
  - Header: class · batch. The owner `Select` (editors) or the owner's name.
  - Numbers: "Last month {prevTotal}", "Renewed {renewed} ({renewedPct}%)", "New {fresh}" and "Unpaid {unpaid}".
  - Main admins only: "At risk {formatLKR(moneyAtRisk)}" (or "Set a fee on Income & profit").
  - Outcome chips (count per status).
  - With no previous list: "No list for {prev month}, so renewals can't be counted yet."
- **`RenewalChart`:** an x axis of day 1 to the month's last day, a y axis of 0–100%.
  - Lines: the snapshot % (`renewed / prev_total`), plus today's live point; and the target line from `targetShare`.
  - It uses `ChartContainer` and the dataviz skill's rules.
- **`CallList`:** the rows from `callList`. Each shows name, WhatsApp (a `wa.me` link), messages sent, last message, and promised date if any.
  - Buttons: "No answer", "Promised…", "Can't afford", "Moved class…" and "Left…".
  - The `…` buttons open `OutcomeDialog` (a date input with min today and max today + 45; a reason select; a class select defaulting to the `moved` suggestion).
  - A row leaves with a 200 ms fade and height collapse (motion `AnimatePresence`; none under reduced motion).
  - Open rows with a moved-class suggestion show "Found in {class} · Confirm", which calls `setFollowupOutcomeAction({ outcome: "moved_class", called: false })`.
  - With nothing to call: "No one to call today."

- [ ] **Step 1:** Read the Next.js docs for nested routes and loading UI; load the `dataviz` skill, then the `animate` skill.
- [ ] **Step 2:** Implement the files above.
- [ ] **Step 3: Check**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass. The build lists `/admin/fee-reminders/renewals`.

- [ ] **Step 4: Look in the browser** (localhost:3000, look only, no saves). Before 078 runs, the page shows an error card and doesn't crash; after it runs, the cards show real numbers. The money row appears only for a main admin.

---

### Task 5: Hand-off

- [ ] Give the owner `supabase/migrations/20261230000078_renewals.sql`. After "done", verify read-only:
  - the columns, table and RLS exist;
  - grants match **Interfaces** (`send_renewal_notices` and `followup_needs_call` are not granted);
  - `cron.job` has `renewal-notices`.
- [ ] Look at the live page. On "yes, push": one commit, `Renewals: who renewed, outcomes for unpaid students, call lists and money at risk`, then push `feature/renewals`.
