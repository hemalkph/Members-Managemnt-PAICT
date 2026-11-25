# Manager tools: renewals, exam countdown, money, team flow, today lists

Date: 2026-11-25 · Status: owner's answers in, waiting for approval

## 1. Why

Production numbers on 25 Nov 2026 (counts only):

| Area | What the data shows |
|---|---|
| Students | 2027 Grand Revision: 143 paid in October. On the 21 Nov list only 70 of them have paid November (49%); 33 new students; 73 unpaid. Those 73 got about 1.6 WhatsApp messages each, and nothing is recorded after that. 2028 Theory: 28 of 35 back. |
| Money | Every paid-list row has an empty amount, so the system knows **no income**. It knows costs: October staff pay Rs 143,390; print job costs; Speed Post receipt totals. |
| Papers | 22 of 30 finished paper stages finished after their due date (2.3 days late on average). Sinhala question writing and Sinhala typesetting are the most often late (4 of 8 each). 23 of 51 tasks done late. Today 10 stages and 10 tasks are overdue, and today's exam has 2 papers still "in progress". |
| Team | Average wait for work review: 6 h in October, 56 h in November. Members are paid on approved work. |

The owner picked nine things to build (section 4). Together they answer four manager questions: *are students staying, are papers on time, are we making money, and does everyone know what to do today?*

## 2. Goals, non-goals, anti-goals

**Goals**
- Every unpaid student ends with a recorded outcome, and nobody falls through after two unanswered messages.
- The main admins see monthly income, costs and profit, and the money at risk from unpaid students.
- Every exam in the next six weeks shows whether its papers are on track, and what's blocking them.
- Work waits no longer than the review limit (24 h by default).
- Each admin and each member opens the app and sees one list of what they must do today.
- Nobody gets work or a deadline on a day they said they're away without being warned.

**Non-goals**
- Student portal, door check, timetable and halls (not picked).
- Sending WhatsApp automatically. Messages still open through wa.me links, as today.
- Changing paper schedules on its own. The system suggests, and an admin approves.
- Splitting staff pay per class. Staff cost is shown for the whole business.

**Anti-goals** (failure even if it works)
- Alerts that people learn to ignore. At most one alert per item per day, and none for things already fixed.
- Money visible to anyone except the main admins.
- A call list that includes students who have already paid. It must re-check after every upload.
- Numbers that look exact but aren't. Estimates are labelled as estimates.

## 3. Constraints

- Next.js 16.4 App Router, Server Actions (`getActionContext`), Supabase Postgres with RLS. Every write goes through a `SECURITY DEFINER` function with `set search_path = ''` and a `has_page(...)` or `is_main_admin()` check. Every `UPDATE` has a `WHERE`.
- One migration per phase, safe to run twice. The owner pastes it in the Supabase SQL Editor, then the change is checked with read-only queries.
- Hand-written types in `lib/supabase/database.types.ts`. DB tests in `tests/db/` (`PG_BIN=/opt/homebrew/bin LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npm run test:db`).
- Times in Asia/Colombo. Scheduled jobs use pg_cron and the existing `public.notify(user, kind, title, body, link, dedupe_key)`.
- Student phone numbers only for people with Fee reminders access. Money only for main admins.
- UI: shadcn components already in the repo, no coloured left-border strips, phone-first for anything used standing up.
- Motion: short and purposeful (150–250 ms), and off when the device asks for reduced motion.
- Git: one branch per phase from the latest `origin/main`; commit and push only after "yes, push"; no AI attribution.

## 4. Approaches

| | Approach | Trade-off |
|---|---|---|
| **A (picked)** | Six phases, each its own branch, migration and PR, merged in order | Each PR is small enough to check. If one phase has a problem, the others still ship. Slower overall, because each phase waits for its merge and SQL run. |
| B | One big branch with everything | Faster for the builder, but one huge review and one large SQL paste. If one part has a problem, nothing ships. |
| C | Build the two "today" lists first and add the features after | The lists would be thin at first and then reworked in every phase. |

The owner handed over the how, so A is the builder's pick. The order follows the dependencies:

| Phase | Delivers | Needs |
|---|---|---|
| 1 | Class fees and the Money page | — |
| 2 | Renewals | 1 (rupees at risk) |
| 3 | Days off and "who's free" | — |
| 4 | Exam countdown | 3 (away people put papers at risk) |
| 5 | Review limit and phone review | — |
| 6 | Today board and My jobs today | 2–5 (they feed the lists) |

`feature/class-ops-month-split` is merged (PR #88), so Phase 2 starts from a main that already has it.

## 5. The design

### Phase 1: Class fees and the Money page (migration 077)

**Data**
- `class_fees(class_id → fee_classes on delete cascade, from_month date, monthly_fee numeric(10,2) ≥ 0, updated_by, updated_at)`, primary key `(class_id, from_month)`. The fee for month M is the row with the latest `from_month ≤ M`, the same pattern as `member_salaries`. RLS on; select and write only through functions.
- `class_fee_set(p_class, p_from_month, p_fee)` and `class_fee_for(p_class, p_month)`, both main admins only. Each save writes an activity entry.

**Income for a class-month** (labelled an estimate):
- If the paid list has amounts, use their sum.
- Otherwise: (paid count − rows labelled "Free enrollment") × the fee.
- Paid count = `class_paid_count` (the newest of an upload or a typed count).
- Half concession cards are counted at the full fee until the export carries amounts (shown as a note).

**Costs for a month**
- Staff pay: `payouts.total_amount` for the month. A month with no payslips yet shows "not closed" plus an estimate from the existing payments calculation.
- Printing: `tute_print_jobs.cost` for jobs not cancelled, by the month they were received (or created, if not yet received).
- Postage: `post_rounds.receipt_total` for rounds not cancelled, by round month.

**UI**
- New page `/admin/money` ("Money"). Page key `money`, `mainOnly: true`, listed under Overview.
- A table of the last 6 months: income per class, total income, staff pay, printing, postage and profit.
- A "Class fees" card: set or change a fee "from this month".
- Phase 2 adds a "money at risk this month" figure here.
- The fee is not shown on the Classes page, because members can open that page.

### Phase 2: Renewals (migration 078)

**Data**
- `fee_classes.followup_owner_id uuid` → profiles: the person who phones this class's unpaid students. It's set on the Classes page. With no owner, the call list goes to everyone with Fee reminders edit access.
- `fee_due_followups`:
  - The status check gains `promised`, `cant_afford` and `moved_class`; it keeps `pending`, `messaged`, `excused` and `dropped`.
  - New columns: `promised_by date`, `reason text` (dropped reasons: exams, money, moved away, timing, joined another institute, other), `moved_to_class uuid`, `call_count int`, `last_called_at`, `last_called_by`.
  - `fee_followup_set` accepts the new fields, and a call outcome increases `call_count`.
- `fee_renewal_snapshots(class_id, month, taken_at, prev_total, renewed, new_students)`. One row is written by the upload action after each paid-list upload.
  - It uses the same three-pass match the Fee reminders page uses (`lib/fees/compare.ts`: email, then phone, then name), so both pages always agree.
  - Typed counts give totals only. They show as "paid so far" dots, not as renewals.

**Rules**
- **Renewed:** a previous-month student matched in this month's list for the same class.
- **Moved class:** an unpaid student found by phone or name in another class's list this month. The page suggests "Moved to <class>?" and one tap confirms.
- **Needs a call:** messaged at least twice, the last message at least 2 days ago, still unpaid, and no outcome. Also "promised" students whose date has passed, and "no answer" calls after 1 day.
- **Outcomes that clear a student:**
  - promised (with a date)
  - can't afford
  - moved class
  - dropped (with a reason)
  - excused
- **Can't afford:** everyone with Concession students edit access gets one daily notice: "N students in <class> say they can't afford the fee". It links to the filtered list. No student data is copied into the concession tables.
- **Daily at 9:00:** each call owner gets one notice, "5 students to call for <class>", deduplicated per day.

**UI:** a new **Renewals** tab on Fee reminders (same page access).
- **One card per class:** last month paid · renewed (%) · new · unpaid · outcome chips. Main admins also see the money at risk: (unpaid − excused − dropped − moved) × fee.
- **Chart:** day of month (x) against % renewed (y), with the target line ("should have by now").
  - Target line: from 0 on day 1 up to the expected share on the due day, flat after that.
  - 90% by the 10th (the owner's answer). Stored as `app_settings.renewal_due_day` (10) and `app_settings.renewal_target_pct` (90). Fee reminders editors can change them on the tab.
  - When there's enough history, last month's real curve shows alongside.
- **Call list:** the owner's name, each student with their WhatsApp/phone and messages sent, and outcome buttons. A row leaves the list with a short exit animation.

### Phase 3: Days off and who's free (migration 079)

**Data**
- `member_days_off(id, user_id, day_from, day_to, note ≤ 200, created_by, created_at)`.
- Members add and remove their own; admins can add for anyone.
- The dates are visible to admins and to people who assign work. The note is visible only to the member and admins.
- `member_load(p_from, p_to)` returns, for each active member: open tasks, open paper stages, items due in the range, and days off in the range.

**UI**
- Members manage their days off on **My week**, which also shows them.
- Every assign picker shows each person as "3 open · away 26–28 Nov", with free people first:
  - task dialog
  - paper stage owner
  - usual paper team
  - class call owner
- A due date that falls on the assignee's day off shows an inline warning with a "Move to next working day" button. It warns; it doesn't block.

### Phase 4: Exam countdown (migration 080)

**UI:** a **Countdown** tab on the Papers page, showing exams in the next 42 days (by `papers.exam_day`, else `exams.exam_date`). Each paper is one row:
- **Stage chips:** done, current or waiting.
- **State:**
  - **late:** a stage is overdue, or the exam is today and the paper isn't done.
  - **at risk:** the current stage's projected finish (start + its typical real duration) is after its due date, or a later stage's owner is away during their window.
  - **on track:** everything else.
- **Blocking stage:** its owner, days late, and a WhatsApp link (the existing pattern).

Late papers for exams in the next 3 days sit at the top.

**Next-person heads-up:** when a stage becomes overdue, the owner of the next stage gets one notice: "<paper>: <stage> is 1 day late, your part may start late". Admins already get the overdue escalation (`send_task_reminders`).

**Learned timing**
- `paper_stage_stats()` returns, per stage type: number done, % late, average days late, and median real duration (`started_at` → `completed_at`).
- The tab shows a suggestion such as: "Sinhala typesetting finishes 2.3 days late on average. Start it 2 days earlier?"
- The stage start and due offsets move from constants in `lib/papers/index.ts` into `app_settings.paper_stage_offsets` (jsonb). The code constants stay as the fallback.
- Changing an offset affects only papers created afterwards, and only an admin can change it.

### Phase 5: Review limit and phone review (migration 081)

- `app_settings.review_limit_hours int default 24` (admins set it on the review page).
- **Reminder job:** every 2 hours between 08:00 and 20:00 Colombo time. For work pending longer than the limit, each admin gets one notice per day: "N pieces waiting over 24 h, the oldest 2 days".
- **Phone review:** on small screens, Work review becomes cards with **Approve** on each card (one tap) and **Send back** (opens the comment). A toast confirms each action.
  - If an existing function can reverse an approval in an open month, the toast offers Undo for 10 s.
  - If not, there is no undo, and nothing new reverses approvals.
- **My work (members):**
  - pending items show "waiting 30 h · reviews usually within 24 h"
  - approved items show their amount and payslip month
  - sent-back items show the comment at the top

### Phase 6: Today board and My jobs today (migration 082, functions only)

`today_board()` builds a list for the viewer. Each line shows only if the viewer has access to that page, so members with page access get the lines that are theirs.

| Line | Page access |
|---|---|
| Classes with no paid count typed today | class_ops |
| Tutes low or out of stock | tutes |
| Print jobs due or late | tutes |
| Post round still packing, or not handed over | post |
| Students to call (Phase 2) | fee_reminders |
| Can't-afford students waiting | students |
| Stages and tasks overdue | tasks/papers |
| Exams in the next 3 days with papers not done (Phase 4) | papers |
| Work waiting over the review limit (Phase 5) | review |
| Next month with no tute plan (in the last 7 days of a month) | class_ops |
| People away today (Phase 3) | members |

`my_jobs_today()` builds the member's list:
- my tasks due or overdue
- my current paper stages
- my calls to make
- class counts to type (class_ops editors)
- post rounds to pack (post editors)
- my days off coming up

**UI**
- **Admin:** a Today card at the top of Overview, with one line per item: a count, words, and a link. Lines with nothing to do are hidden, and "All clear" shows when the list is empty.
- **Member:** a "My jobs today" card at the top of the Dashboard.
- **Motion:** a line that's done leaves with a short exit when the page refreshes, and counts change without a jump.

## 6. Tests and checks (each phase)

- DB tests for every new function:
  - access: allowed, refused, and main-admin-only
  - the rules (renewed, moved class, needs a call, at risk, the fee "from month")
  - safe to run twice
- `npm run typecheck`, `npm run lint`, `npm test`, then a look in the browser at localhost:3000 (look only, no saves on real data).
- After the owner runs each migration: read-only queries that confirm the tables, functions and grants.

## 7. The owner's answers (25 Nov 2026)

1. **Fees:** one monthly fee per class. Online, Physical and new students pay the same.
2. **Due day:** 90% of last month's students should have paid by the 10th.

## 8. Calls made by the builder (correct any)

- Income is an estimate from paid count × fee until the exports carry amounts. Half cards are counted at the full fee.
- Staff pay is shown for the whole business, not split per class.
- The fee lives on the Money page (main admins only), not on the Classes page.
- A call is due after 2 messages and 2 days with no payment. A "no answer" call comes back the next day.
- Can't-afford students go to the concession team as a notice, not as copied records.
- Days off warn but don't block.
- Paper timing changes are suggestions an admin applies. They affect new papers only.
- Review reminders run every 2 hours from 8 am to 8 pm, once per day per admin.
- The Today and My jobs lists show only lines the viewer has access to.
- Six phases, built in order, each its own branch and PR.
- Renewal numbers on the page are worked out live from the lists. The snapshots only draw the chart, and the first snapshot for a month is taken when the page first opens it. Several uploads on one day keep the last.
- Due, overdue and escalation reminders don't change for days off. Days off only warn at assignment.
- Every active class is expected to get a count each day, Online classes included.
- Papers with no exam day or exam date are left out of the countdown.

## 9. Left to the builder

Component layout, query shapes, index choices, chart drawing (an SVG line drawn in the repo's style), test fixtures, and the exact wording of notices.
