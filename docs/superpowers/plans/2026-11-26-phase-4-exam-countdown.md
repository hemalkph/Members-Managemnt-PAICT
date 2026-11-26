# Phase 4: Exam countdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For every exam in the next six weeks, show whether each paper is on track, at risk or late, and which stage and person is holding it up. Tell the next person when the stage before theirs runs late. Suggest earlier start days from how long stages really take.

**Architecture:**
- **Migration 080:**
  - Adds editable stage offsets (`app_settings.paper_stage_offsets`).
  - Adds a stage-timing stats function.
  - Adds a daily heads-up job for the owner of the next stage.
- **Pure rules:** `lib/papers/countdown.ts` works out each paper's state and the timing suggestions.
- **Page:** a new page `/admin/papers/countdown` (Papers page access), reached by an "Exam countdown" button on Papers.

**Tech Stack:** Next.js 16.4, Supabase Postgres + pg_cron, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-manager-tools-design.md` (section 5, Phase 4; section 8: suggestions are applied by an admin and affect new papers only; papers with no exam day are left out)

## Global Constraints

- **Branch:** `feature/exam-countdown`. **Migration file:** `supabase/migrations/20270101000080_exam_countdown.sql`, safe to run twice; functions are `security definer` with `search_path = ''`.
- **Pre-exam stages** (the ones the countdown judges): `create_si, typeset_si, convert, typeset_en, review_si, review_en, handover`. Scheme and mark stages are ignored.
- **Exam day:** `papers.exam_day`, else the exam's `exam_date`. Papers with neither are left out. The window is today to today + 42, plus any paper whose exam day has passed but whose handover isn't done.
- **State, in order:**
  - `ready`: handover is done or skipped, or the paper status is `done`.
  - `late`: a pre-exam stage is in progress past its due date, or the exam day is today or past and the paper isn't ready.
  - `at_risk`: the current stage's projected finish is after its due date, or a later waiting stage's owner is away during that stage's start–due days. Projected finish = (`started_at` date or today, whichever is later) + the median real days for that stage (1 day when there's no history).
  - `on_track`: everything else.
- **Blocking stage:** the in-progress pre-exam stage with the lowest position, else the first waiting one.
- **Suggestion rule:** for a stage type with at least 3 done, at least 40% late and an average of at least 1 day late, suggest starting `ceil(avg days late)` days earlier. Only the start moves; the due date stays.
- **Offsets:** `app_settings.paper_stage_offsets` jsonb `{ stage: { start, due } }` overrides the `STAGES` constants. Values are integers from −30 to 30 with start ≤ due. Only admins can change them. They're used only when a new paper is planned.
- **Heads-up:** daily at 09:00 Colombo (`'30 3 * * *'`), job `stage-late-headsups`. For each pre-exam stage in progress and past its due date, the owner of each waiting stage that takes its input from it (the `STAGE_INPUTS` pairs) is told once.
  - Kind `stage.before_late`, title `"<paper>: <stage label> is late"`, body `"It was due <D Mon>. Your part may start late."`, link `/papers/<id>`.
  - Dedupe `stage-before-late:<late stage id>:<next stage id>`.
  - Nobody is notified about their own stage.
- **Git:** no commits until "yes, push"; one commit at the end under the owner's name, with no AI lines.

## Review Focus

1. **The exam is today and the paper isn't handed over:** `late` and at the top, even if no stage is overdue. *(Task 2 `exam today not ready`)*
2. **A skipped stage** (Sinhala-only papers skip English stages): never blocking and never late. *(Task 2 `skipped stages ignored`)*
3. **No history for a stage type:** a projection of 1 day and no suggestion. *(Task 2 `no history`)*
4. **The heads-up:** never sent to the late stage's own owner, and only once per pair. *(Task 1 `headsup once, not to self`)*
5. **Bad offsets:** start after due, an unknown stage or out of range are refused. *(Task 1 `offsets validated`)*

---

### Task 1: Migration 080 and DB tests

**Files:** Create `supabase/migrations/20270101000080_exam_countdown.sql`; Test `tests/db/exam-countdown.test.ts`

**Interfaces (produces):**
- `app_settings.paper_stage_offsets jsonb not null default '{}'`.
- `paper_stage_offsets() returns jsonb`: `has_page('papers')`.
- `paper_stage_offsets_set(p_offsets jsonb) returns void`:
  - Access: `is_admin()`.
  - Validates the keys against the 11 stage names and that each value is an object with integer `start` and `due` in −30..30, start ≤ due. Otherwise P0001 "Check the stage days."
  - Writes activity `settings.paper_offsets`.
- `paper_stage_stats() returns table (stage text, done integer, late integer, avg_days_late numeric, median_days numeric)`:
  - Access: `has_page('papers')`.
  - Counts stages with status `done`, a due date and `completed_at`.
  - `late` = completed on a Colombo date after `due_date`; `avg_days_late` is over the late ones (0 if none).
  - `median_days` = median of `(completed_at − coalesce(started_at, completed_at))` in days, rounded to 1 decimal.
- `send_stage_late_headsups() returns integer`: internal (not granted). Behaviour as in Global Constraints.
- `cron.schedule('stage-late-headsups', '30 3 * * *', …)`.

- [ ] **Step 1: Write the failing tests:** an admin, a papers-page member, plain members A (late owner) and B (next owner), and a paper built with the existing helpers or direct inserts as owner. Stages: `create_si` (owner A, in progress, due yesterday) and `typeset_si` (owner B, waiting).
  - `access`: a plain member gets 42501 from `paper_stage_stats` and `paper_stage_offsets_set`; the papers member gets ok from stats and 42501 from set.
  - `offsets validated`: `{"typeset_si":{"start":-3,"due":-4}}` gives P0001; `{"nope":{"start":-1,"due":0}}` gives P0001; `{"typeset_si":{"start":-40,"due":-3}}` gives P0001; `{"typeset_si":{"start":-6,"due":-3}}` saves, and `paper_stage_offsets()` returns it.
  - `stats`: done stages of one type, 2 on time and 1 three days late, give `done ≥ 3`, `late ≥ 1` and `avg_days_late ≥ 3` for that type. A unique stage type isn't possible, so assert on deltas: run stats before and after the inserts.
  - `headsup once, not to self`: `send_stage_late_headsups()` gives B one `stage.before_late` with the paper title, and A none. A second run gives none new.
- [ ] **Step 2:** Run `PG_BIN=/opt/homebrew/bin LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx vitest run --config vitest.db.config.ts tests/db/exam-countdown.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** PASS, then the full `npm run test:db`.

### Task 2: Countdown rules and unit tests

**Files:**
- Create `lib/papers/countdown.ts`
- Modify `lib/papers/index.ts`: `defaultSchedule(examDay, offsets?: StageOffsets)` uses overrides; `export type StageOffsets = Partial<Record<PaperStageName, { start: number; due: number }>>`; `export const PRE_EXAM_STAGES`.
- Modify `lib/papers/queries.ts`: select `started_at`; `StageView.startedAt: string | null`.
- Test `tests/unit/countdown.test.ts`

**Interfaces (produces):**
- `export type StageStat = { stage: PaperStageName; done: number; late: number; avgDaysLate: number; medianDays: number }`
- `export type PaperState = "ready" | "late" | "at_risk" | "on_track"`
- `export type CountdownRow = { paper: PaperView; examDay: string; state: PaperState; blocking: StageView | null; daysLate: number; reason: string }`
- `export function paperCountdown(paper: PaperView, examDay: string, today: string, stats: StageStat[], daysOff: DayOff[]): CountdownRow`, where `reason` is one short sentence, e.g. "Type set (Sinhala) is 2 days late", "Exam is today and it isn't handed over", "Create (Sinhala) usually takes 4 days", or "Nimal is away during Review (Sinhala)".
- `export function sortCountdown(rows: CountdownRow[], today: string): CountdownRow[]`: late papers with an exam within 3 days first, then by exam day, then late before at risk before on track before ready.
- `export type OffsetSuggestion = { stage: PaperStageName; label: string; avgDaysLate: number; latePct: number; earlierBy: number; current: { start: number; due: number }; next: { start: number; due: number } }`
- `export function suggestOffsets(stats: StageStat[], offsets: StageOffsets): OffsetSuggestion[]`

- [ ] **Step 1: Write the failing tests** (fixtures built from `PaperView` partials):
  - `late stage`: an in-progress `typeset_si` due 2 days ago gives `late`, blocking `typeset_si`, `daysLate = 2`.
  - `exam today not ready`: no stage overdue, exam day = today, handover waiting, gives `late`.
  - `ready`: handover done gives `ready` and blocking null.
  - `at risk by duration`: `create_si` started today and due tomorrow, with median 4 days, gives `at_risk`.
  - `at risk by day off`: the waiting `review_si` owner is away during its days, gives `at_risk`, and the reason names the owner and stage.
  - `skipped stages ignored`: English stages skipped, others on time, gives `on_track`, and blocking is never a skipped stage.
  - `no history`: with no stats, the projection is 1 day, so a stage due tomorrow is `on_track`.
  - `sort`: late within 3 days comes before an earlier on-track exam.
  - `suggestions`: `typeset_si` with done 8, late 4, avg 2.3 gives earlier by 3, `next.start = current.start − 3`, due unchanged. A stage with done 2 gives no suggestion. One with avg 0.5 gives none.
  - `defaultSchedule uses overrides`: `{typeset_si: {start: -6, due: -3}}` gives a start 6 days before the exam.
- [ ] **Step 2:** Run `npx vitest run tests/unit/countdown.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run `npx vitest run tests/unit && npm run typecheck`. Expected: PASS.

### Task 3: The countdown page, Apply, and wiring

**Files:**
- Modify `lib/supabase/database.types.ts`: the 3 granted functions and the `app_settings` column.
- Create `lib/papers/countdown-queries.ts` (server-only): `getCountdownPage(supabase, today)` returns `{ rows: CountdownRow[]; stats: StageStat[]; suggestions: OffsetSuggestion[]; error: string | null }`.
  - It uses `getPapers` (in progress), an exams lookup for exam dates, `getTeamDaysOff` (today .. today + 42) and the two RPCs.
  - `error` is set when `paper_stage_stats` fails (before 080).
- Create `lib/actions/paper-offsets.ts`: `applyOffsetSuggestionAction({ stage, start, due })`. It reads the current offsets, merges, and calls `paper_stage_offsets_set`. Admins only (`getActionContext({ admin: true })`). It revalidates `/admin/papers` and `/admin/papers/countdown`.
- Create `app/(app)/admin/papers/countdown/page.tsx` and `loading.tsx`, and `components/papers/countdown-list.tsx` and `components/papers/stage-timing-card.tsx`.
  - **Header:** "Exam countdown", with a back link to Papers.
  - **List:** grouped by exam day ("Wed 2 Dec · in 6 days"). Each paper row shows the title and exam label, a state badge (Late / At risk / On track / Ready), stage chips for the pre-exam stages (done, current or waiting, as `Badge` variants), and the reason. A late or at-risk row also shows the blocking owner, with a WhatsApp link when the team directory has their number.
  - **Stage timing card:** the stats table (stage, done, late %, avg days late, typical days). Each suggestion has an **Apply** button for admins, which says "New papers start this stage N days earlier".
- Modify `app/(app)/admin/papers/page.tsx`: an "Exam countdown" button in the header actions, and pass `offsets` to `NewPaperDialog`.
- Modify `components/papers/new-paper-dialog.tsx`: an `offsets` prop passed to `defaultSchedule`.
- Modify `components/notifications/notification-item.tsx`: META `stage.before_late` (HourglassIcon, warning tone).

- [ ] **Step 1:** Implement it.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm test && npm run build`. Expected: all pass.
- [ ] **Step 3:** Browser check (look only): the countdown page shows the error card before 080 runs, and the papers once it has.

### Task 4: Hand-off
- [ ] Give the owner the migration. After "done", verify read-only (the column, grants and cron job), look at the page, and on "yes, push" make one commit: `Exam countdown: paper state per exam, next-person heads-up and stage timing suggestions`.
