# Phase 3: Days off and who's free — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members mark the days they're away. Everyone who assigns work sees each person's open work and days off, and gets a warning (with a one-tap fix) when a deadline lands on someone's day off.

**Architecture:**
- **Migration 079:** a `member_days_off` table behind three functions. Notes are shown only to the member themself and to admins.
- **Shared helper:** `lib/team/availability.ts` (pure) turns open tasks plus days off into labels such as "3 open · away 26–28 Nov", sorts free people first, and finds the next working day.
- **Pages:** each assign picker gets the labels and the warning. My week gets a Days off card.

**Tech Stack:** Next.js 16.4, Supabase Postgres, Zod, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-manager-tools-design.md` (section 5, Phase 3; section 8: days off warn, never block; reminders unchanged)

## Global Constraints

- **Branch:** `feature/days-off` (from `origin/main`, already created).
- **Migration file:** `supabase/migrations/20261231000079_days_off.sql`. It must be safe to run twice. Functions are `security definer` with `set search_path = ''`. Every `UPDATE` and `DELETE` has a `WHERE`.
- **A day off:** `day_from ≤ day_to ≤ day_from + 90`, and `day_to ≥ today` (Colombo) when added. A new range can't overlap the same person's saved days off.
- **Who sees what:**
  - A member sees and changes their own days off.
  - Admins see and change anyone's.
  - People who assign work (`has_page` on `tasks`, `papers`, `class_ops` or `fee_reminders`) see others' dates only, with the note `''`.
- **Warn, never block.** Due, overdue and escalation reminders don't change.
- **Label format:** `"{n} open"`, plus `" · away {range}"` when any day off overlaps the window, where range is `"26 Nov"` or `"26–28 Nov"` (`formatDayRange` from `lib/core/format` if present, else the same style as My week).
- **Git:** no commits until "yes, push"; one commit at the end under the owner's name, with no AI lines.

## Review Focus

1. **A deadline on a day off:** the warning shows the person and the date. "Move to next working day" picks the first day after the whole range, not just the next day. *(Task 2 `next working day skips the whole range`)*
2. **Overlapping or back-to-back ranges:** overlapping ranges are refused. Ranges that touch are allowed, and the next working day skips across both. *(Task 1 `overlap refused`, Task 2 `adjacent ranges`)*
3. **Someone else's note:** an assigner never sees another person's note. *(Task 1 `notes stay private`)*
4. **A member adding days off for someone else:** refused. An admin can. *(Task 1 `only admins add for others`)*
5. **Past dates:** a range that has already ended can't be added. *(Task 1 `past range refused`)*

---

### Task 1: Migration 079 and DB tests

**Files:** Create `supabase/migrations/20261231000079_days_off.sql`; Test `tests/db/days-off.test.ts`

**Interfaces (produces):**
- **Table:** `member_days_off (id uuid pk default gen_random_uuid(), user_id uuid → profiles on delete cascade, day_from date, day_to date, note text not null default '' (≤ 200), created_by uuid → profiles on delete set null, created_at timestamptz default now(), check (day_to >= day_from and day_to <= day_from + 90))`. It has an index on `(user_id, day_to)`. RLS on, everything revoked.
- **`day_off_add(p_from date, p_to date, p_note text default '', p_user uuid default null) returns uuid`:**
  - The target is `coalesce(p_user, auth.uid())`. Another person's target needs `is_admin()`, else 42501.
  - The target must be an active profile.
  - Errors:
    - P0001 "Pick a range of up to 90 days." (bad order or > 90 days)
    - P0001 "Pick days from today on." (`p_to <` today, Colombo)
    - P0001 "These days overlap days off already saved."
  - Writes activity `member.day_off_added`.
- **`day_off_delete(p_id uuid) returns void`:** own row or `is_admin()`, else 42501. Writes activity `member.day_off_removed`.
- **`team_days_off(p_from date, p_to date) returns table (id uuid, user_id uuid, day_from date, day_to date, note text)`:**
  - Rows overlapping `[p_from, p_to]` (at most 400 days, else P0001).
  - Admins and assigners (see Global Constraints) get every row; anyone else gets only their own.
  - `note` is `''` unless the caller is an admin or the row is their own.
  - Ordered by `day_from`.
- Grants to authenticated on all three functions.

- [ ] **Step 1: Write the failing tests:** a member, a second member, an admin, a tasks-page assigner, and `TODAY`.
  - `own days off`: a member adds `TODAY+2 .. TODAY+4` with the note "Exam"; `team_days_off(TODAY, TODAY+30)` as that member returns it with the note.
  - `past range refused`: `TODAY-5 .. TODAY-2` gives P0001.
  - `too long refused`: 91 days gives P0001; `p_to < p_from` gives P0001.
  - `overlap refused`: `TODAY+3 .. TODAY+6` for the same member gives P0001; `TODAY+5 .. TODAY+6` (touching) is ok.
  - `only admins add for others`: the member adding for the second member gives 42501; the admin adding for the second member is ok.
  - `notes stay private`: the assigner sees the member's row with `note = ''`; the admin sees "Exam"; the second member (no assigner page) sees only their own rows.
  - `delete`: the second member deleting the member's row gives 42501; the member deleting their own is ok; the admin deleting any is ok.
- [ ] **Step 2:** Run `PG_BIN=/opt/homebrew/bin LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx vitest run --config vitest.db.config.ts tests/db/days-off.test.ts`. Expected: FAIL, because the functions are missing.
- [ ] **Step 3:** Write migration 079 exactly as above.
- [ ] **Step 4:** Run the same command (PASS), then the full `npm run test:db` (no failures).

### Task 2: Availability helper and unit tests

**Files:** Create `lib/team/availability.ts`; Test `tests/unit/availability.test.ts`

**Interfaces (produces):**
- `export type DayOff = { id: string; userId: string; from: string; to: string; note: string }`
- `export function awayOn(daysOff: DayOff[], userId: string, day: string): DayOff | null`
- `export function nextWorkingDay(daysOff: DayOff[], userId: string, day: string): string`: the first day ≥ `day` that is not inside any of the user's ranges. Touching ranges are crossed in one go.
- `export function availabilityLabel(open: number, daysOff: DayOff[], userId: string, from: string, to: string): string`
- `export function freeFirst<T extends { id: string; open: number }>(members: T[], daysOff: DayOff[], from: string, to: string): T[]`: people with no day off in the window come first, then fewer open items, then name order kept (stable).
- `export function mapDaysOff(rows: { id: string; user_id: string; day_from: string; day_to: string; note: string }[]): DayOff[]`

- [ ] **Step 1: Write the failing tests:**
  - `away on`: inside, on the edges, and outside the range.
  - `next working day skips the whole range`: `26..28 Nov`, starting from 27 Nov, gives `2026-11-29`.
  - `adjacent ranges`: `26..28` plus `29..30`, starting from 26 Nov, gives `2026-12-01`.
  - `not away`: returns the day itself.
  - `label`: `availabilityLabel(3, …26–28 Nov…, from 25 Nov, to 1 Dec)` gives `"3 open · away 26–28 Nov"`; with no overlap, `"3 open"`; a single day gives `"away 26 Nov"`.
  - `free first`: away people sort after free ones, then by open count.
- [ ] **Step 2:** Run `npx vitest run tests/unit/availability.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run `npx vitest run tests/unit && npm run typecheck`. Expected: PASS.

### Task 3: Pickers, warnings and the My week card

**Files:**
- Modify `lib/supabase/database.types.ts`: the three functions.
- Create `lib/team/days-off-queries.ts` (server-only): `getTeamDaysOff(supabase, from, to): Promise<DayOff[]>`, which returns `[]` on error, so pages still work before 079 runs.
- Create `lib/actions/days-off.ts`: `addDayOffAction({ from, to, note, user_id? })` and `deleteDayOffAction(id)`. Each uses `getActionContext()` and revalidates `/week`, `/admin/tasks` and `/admin/papers`. The schema `dayOffSchema` goes in `validation.ts`.
- Create `components/team/day-off-warning.tsx`: `DayOffWarning({ name, day, nextDay, onMove })`, an inline amber note "{name} is away on {day}" with a "Move to {nextDay}" button. It never blocks saving.
- **Task dialog:**
  - Modify `app/(app)/admin/tasks/page.tsx`: members get `open` (count of their open tasks) and the page passes `daysOff` (the next 60 days).
  - Modify `components/tasks/task-dialog.tsx`: member items show `availabilityLabel`, sorted with `freeFirst` for the window [today, due date or today + 7]. A `DayOffWarning` appears under the due date when the chosen member is away that day.
- **New-paper dialog:**
  - Modify `app/(app)/admin/papers/page.tsx`: members get `daysOff` (60 days); stage controls get the same.
  - Modify `components/papers/new-paper-dialog.tsx`: next to each stage's owner, show "away …" when the owner's day off overlaps that stage's start–due window. The existing busy check stays.
- Modify `components/papers/stage-controls.tsx`: a `DayOffWarning` on the due date when the chosen owner is away that day.
- **Renewals owner picker:**
  - Modify `components/fees/renewals/owner-select.tsx` and `lib/fees/renewals-queries.ts`: the team items show " · away …" for days off in the next 7 days.
- **My week:**
  - Modify `app/(app)/week/page.tsx`: a day the member is away shows "Day off" in place of "Free" (items still listed).
  - Add a **Days off** card (`components/team/days-off-card.tsx`, client): the member's upcoming days off with Remove, and a small form (from, to, note, plus a "For" member select shown only to admins).

- [ ] **Step 1:** Implement all of the above.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm test && npm run build`. Expected: all pass.
- [ ] **Step 3:** Browser check (look only): My week shows the Days off card. The task dialog shows "N open" labels. Before 079 runs, pages load without errors.

### Task 4: Hand-off

- [ ] Give the owner the migration. After "done", verify read-only (the table, RLS, grants), look at the pages, and on "yes, push" make one commit: `Days off: members mark days away; assign pickers show who's free and warn about deadlines on days off`.
