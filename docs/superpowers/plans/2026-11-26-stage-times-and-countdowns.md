# Stage times and live countdowns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When creating a paper, the admin picks the work window: a start date-time and a hand-over deadline date-time, using the shadcn calendar. The pre-exam stages fill that window in their usual shape. Every stage then shows a live countdown ("1 d 4 h left", red when late) to its owner and admins.

**Design (agreed 2026-11-26):**
- **Fill rule:** keep the usual shape and stretch it. The pre-exam stages' default (or admin-overridden) offsets form a template from Create's start to the end of Hand over's due day. That template is mapped linearly onto [start, deadline], and each boundary is rounded to the nearest hour.
- **The end** is the hand-over deadline. Scheme and marking stages stay counted from the exam day, as now, with no times.
- **The countdown shows on:** the member's My week and My tasks, the paper page stage cards, the admin Papers list (current stage), and the Exam countdown page (blocking stage).

**Architecture:**
- **Migration 081:** `paper_stages.start_at` and `due_at` (timestamptz, nullable).
  - A `BEFORE INSERT OR UPDATE` trigger keeps the dates and times in step: a new time sets its Colombo date; a date-only edit keeps the old time of day.
  - `paper_stages_set_times(p_paper, p_times jsonb)` saves the times.
- **Pure helpers** in `lib/papers/times.ts`: the stretch, rounding, and the countdown text.
- **New UI:** shadcn `Calendar` (adds the `react-day-picker` dependency), a `DateTimePicker`, and a client `StageCountdown` chip that updates every minute.

**Tech Stack:** Next.js 16.4, Supabase Postgres, shadcn/ui Calendar (react-day-picker v9), Vitest.

## Global Constraints

- **Branch:** `feature/stage-times`, stacked on `feature/exam-countdown` (Phase 4, not merged yet). It must be merged after it.
- **Migration file:** `supabase/migrations/20270102000081_stage_times.sql`, safe to run twice; functions are `security definer` with `search_path = ''`.
- **All times are Asia/Colombo.** A stage with no `due_at` counts down to 23:59 on its `due_date`.
- **Countdown text:**
  - more than 1 day left: `"2 d 4 h left"`
  - 1 hour to 1 day: `"5 h 20 m left"`
  - under 1 hour: `"45 m left"`
  - past due: `"Late 1 d 3 h"` (destructive tone)
  - done or skipped stages show no countdown
  - it updates every 60 s, with no animation (it's read, not watched)
- **Who can set times:** the same people who can create or edit papers (`is_admin()` or `has_page('papers', true)`, matching `update_paper_stage`).
- **Default window** for a new paper: start = Create's default start day at 08:00, deadline = Hand over's default due day at 18:00, both from the exam day and the stage offsets. Changing the exam day resets the window.
- **No commits until "yes, push"**; one commit at the end under the owner's name, with no AI lines. Migration 081 is pasted by the owner.

## Review Focus

1. **Editing only a stage's date in the old dialog path** keeps its time of day, and the countdown follows the new date. *(Task 1 `date edit keeps time`)*
2. **A window shorter than the template** (e.g. 2 days): stages still keep their order and start ≤ due, and nothing is rounded into a negative length. *(Task 2 `short window`)*
3. **The deadline before the start:** the dialog refuses to save and says why. *(Task 2 `window order`, Task 3 check)*
4. **Old stages without times:** the countdown runs to the end of the due day. *(Task 2 `no time falls back`)*
5. **A Sinhala-only paper:** skipped English stages get no times and never show a countdown. *(Task 2 `skipped excluded`)*

---

### Task 1: Migration 081 and DB tests

**Files:** Create `supabase/migrations/20270102000081_stage_times.sql`; Test `tests/db/stage-times.test.ts`

**Interfaces (produces):**
- `alter table public.paper_stages add column if not exists start_at timestamptz, add column if not exists due_at timestamptz`.
- Trigger `paper_stages_sync_times`, `before insert or update of start_date, due_date, start_at, due_at`:
  - If `due_at` is new or changed (and not null), set `due_date = (due_at at time zone 'Asia/Colombo')::date`.
  - Otherwise, if `due_date` changed and the old `due_at` is not null, set `due_at = (new.due_date + (old.due_at at time zone 'Asia/Colombo')::time) at time zone 'Asia/Colombo'`.
  - If `due_date` is set to null, set `due_at` to null.
  - Start works the same way.
- `paper_stages_set_times(p_paper uuid, p_times jsonb) returns integer`:
  - Access: `is_admin() or has_page('papers', true)`, else 42501.
  - `p_times` = `{ "<stage>": { "start_at": iso, "due_at": iso } }`.
  - Errors (P0001): "Check the stage times." (start after due, or not ISO); "Paper not found."
  - Updates only that paper's non-skipped stages named in `p_times`, and keeps each stage task's `due_date` in step (`tasks.due_date = new due_date where paper_stage_id = stage.id`).
  - Returns the number of stages updated and writes activity `paper.times_set`.

- [ ] **Step 1: Write the failing tests:** an admin, a plain member, and a paper with `create_si` and `typeset_si` stages (one with a stage task) inserted as owner.
  - `access`: a plain member gets 42501.
  - `times set dates`: `{create_si: {start_at: "2026-11-30T08:00:00+05:30", due_at: "2026-12-04T18:00:00+05:30"}}` gives `due_date = 2026-12-04` and `start_date = 2026-11-30`, with the stage task's due date also 2026-12-04.
  - `date edit keeps time`: as owner, `update paper_stages set due_date = '2026-12-05'` gives `due_at` = 2026-12-05 18:00 Colombo.
  - `bad times`: start after due gives P0001.
- [ ] **Step 2:** Run `PG_BIN=/opt/homebrew/bin LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx vitest run --config vitest.db.config.ts tests/db/stage-times.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** PASS, then the full `npm run test:db`.

### Task 2: Time helpers and unit tests

**Files:** Create `lib/papers/times.ts`; Test `tests/unit/stage-times.test.ts`

**Interfaces (produces):**
- `export type StageTimes = Partial<Record<PaperStageName, { startAt: string; dueAt: string }>>`. Values are ISO strings with the `+05:30` offset.
- `export function defaultWindow(examDay: string, offsets?: StageOffsets): { start: string; end: string }`: 08:00 on Create's start day and 18:00 on Hand over's due day.
- `export function stretchStages(start: string, end: string, skipped: PaperStageName[], offsets?: StageOffsets): StageTimes`:
  - Pre-exam stages only, skipped ones left out.
  - The template runs from Create's start day 00:00 to the day after Hand over's due day 00:00.
  - Linear map; each start and due is rounded to the hour; due ≥ start + 1 h.
- `export function windowError(start: string, end: string): string | null`: "The hand-over deadline must be after the start." or null.
- `export function stageDeadline(dueAt: string | null, dueDate: string | null): number | null`: ms since epoch; falls back to 23:59 Colombo on the due date.
- `export function countdownText(deadlineMs: number, nowMs: number): { text: string; late: boolean }`
- `export function toColomboISO(date: string, time: string): string` and `export function fromColomboISO(iso: string): { date: string; time: string }`.

- [ ] **Step 1: Write the failing tests:**
  - `default window`: exam 2026-12-09 gives start `2026-11-30T08:00:00+05:30` and end `2026-12-08T18:00:00+05:30`.
  - `stretch keeps shape`: the default window gives `create_si` from 11-30 08:00, `handover.dueAt = end`, and `typeset_si.startAt ≥ create_si.dueAt`.
  - `short window`: 2026-12-01 08:00 → 2026-12-03 08:00 gives every stage with `startAt < dueAt`, in the same order.
  - `skipped excluded`: skipped `convert` is missing from the result.
  - `window order`: a deadline before the start gives the message; a valid window gives null.
  - `countdown text`: 2 d 4 h → "2 d 4 h left"; 5 h 20 m → "5 h 20 m left"; 45 m → "45 m left"; −27 h → "Late 1 d 3 h", late true.
  - `no time falls back`: `stageDeadline(null, "2026-12-04")` = 2026-12-04 23:59 Colombo.
  - `colombo iso round trip`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/stage-times.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run `npx vitest run tests/unit && npm run typecheck`. Expected: PASS.

### Task 3: Calendar picker, new-paper window, stage editing, countdowns

**Files:**
- Add the shadcn Calendar: run `npx shadcn@latest add calendar` (adds `react-day-picker` and `components/ui/calendar.tsx`). If the CLI can't run, add `react-day-picker@^9` and write the standard shadcn v4 `calendar.tsx`.
- Create `components/ui/date-time-picker.tsx`: `DateTimePicker({ value, onChange, minDate?, disabled?, ariaLabel })`. `value` is the ISO from `toColomboISO`. It's a Popover with a `Calendar mode="single"` and an `Input type="time" step=900`, and the trigger shows "Mon 30 Nov, 8:00 am".
- Create `components/papers/stage-countdown.tsx`: `StageCountdown({ dueAt, dueDate, status })`, a client chip that updates every 60 s (`setInterval`, cleared on unmount). It renders nothing for done or skipped stages.
- **New-paper dialog** (`components/papers/new-paper-dialog.tsx`):
  - A "Work window" row with **Start** and **Hand over by** DateTimePickers, filled from `defaultWindow` and reset when the exam day changes.
  - Changing either one runs `stretchStages`, which fills each pre-exam stage's start and due date-times.
  - The per-stage date inputs become DateTimePickers for pre-exam stages; post-exam stages keep their date inputs.
  - `windowError` is shown inline and blocks saving.
  - Save sends the dates as today (from the times) plus `times`.
- `lib/actions/papers.ts` and `lib/core/validation.ts` (`paperSchema` gets an optional `times`): after `create_paper` succeeds, call `paper_stages_set_times`. A failure there is reported as "Paper saved, but the stage times weren't".
- **Stage editor** (`components/papers/stage-controls.tsx` `EditStageDialog`): Starts and Due become DateTimePickers, and the dates come from them. `updatePaperStageAction` takes optional `start_at` and `due_at`, and after `update_paper_stage` calls `paper_stages_set_times` for that one stage. The days-off warning keeps working on the date.
- **Queries:** `lib/papers/queries.ts` selects `start_at` and `due_at` (`StageView.startAt` and `dueAt`). `lib/tasks/queries.ts` selects `stage:paper_stages(paper_id, due_at)`, and `TaskView.stageDueAt` is added.
- **Countdown places:**
  - `app/(app)/week/page.tsx`: stage items get `dueAt` and render `StageCountdown`.
  - `components/tasks/task-card.tsx`: open stage tasks show `StageCountdown` next to the due label.
  - `app/(app)/papers/[id]/page.tsx`: each stage card.
  - `components/papers/paper-row.tsx`: the current stage.
  - `components/papers/countdown-list.tsx`: the blocking stage.
- `lib/supabase/database.types.ts`: the two columns and the function.

- [ ] **Step 1:** Implement it.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm test && npm run build`. Expected: all pass.
- [ ] **Step 3:** Browser check (look only, no saves):
  - the new-paper dialog shows the window pickers and the calendar opens;
  - changing the deadline moves the stage times;
  - My week and the paper page show countdowns (times fall back to the end of the day before 081 runs).

### Task 4: Hand-off
- [ ] Give the owner the migration. After "done", verify read-only (the columns, trigger and grants), look at the pages, and on "yes, push" make one commit: `Stage times: pick the paper's work window on a calendar; stages fill it; live countdowns per stage`.
