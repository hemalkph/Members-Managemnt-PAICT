# Team Work Tracker

A web app for the A/L ICT class team. **Members** log the work they do each month; **admins** manage members, sections and roles, and review the work.

Built with Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui · React Bits · Supabase (Auth, Postgres, Storage) · Zod + react-hook-form.

---

## Features

**Members**
- Log in / log out / forgot password (email link → set a new password)
- Profile: full name, phone, WhatsApp, NIC, profile photo, assigned roles (read-only). **The profile must be complete** (name, phone, WhatsApp, valid NIC) before a member can log work
- Birthday: read automatically from the NIC (old `991234567V` and new `200212345678` formats). On their birthday, members get a confetti celebration when they open the app
- Bank details in a separate, protected table. The account number is always masked (`****1234`); only the owner gets a **Show** button
- Submit work: month, one of their own roles, title, description, quantity, date done, links and file attachments (max 10 MB each, private storage)
- My work: submissions per month with a Pending / Approved / Rejected badge and the admin's comment. Edit or delete while still Pending
- Monthly summary: total, approved and pending for the selected month

**Admins**
- Dashboard: stat cards, submissions-per-section chart, recent submissions
- Members: stat cards (total / active / inactive / admins), search and filter (section, role, active/inactive), add by email invite **or** with a temporary password, edit details, assign several roles with a multi-select, give admin access, **reset a member's password** (with a strong-password generator), deactivate/activate, view bank details (masked)
- Member detail page: profile, roles, bank details and month-by-month work history
- Work review: filter by month, section, role, member and status; open a submission to see details and attachments; approve or reject with a comment; bulk approve
- Monthly report: approved count and quantity per member per role, with CSV export
- Sections & roles: create, rename and delete (stored in the database, not hard-coded)
- Rates & budget: set per-unit prices for each role (per page for Type Setting and Converting, per design category such as Thumbnail / Flyer / Banner / Template for Graphic Design, per paper and per marking scheme for Paper Creating). Categories can be added or removed; roles like WhatsApp Admin and LMS Admin can be marked **Fixed salary**. A **live budget preview in a phone mock-up** calculates the cost as you type prices and quantities
- **Analytics (main admins only):** monthly spending (radar chart), spending by section (donut), budget used (radial), payouts per member (salary + work), spending by role, and a monthly budget setting
- **Fixed salaries:** for salaried roles (e.g. WhatsApp Admin, LMS Admin) main admins enter each member's monthly salary in Rates & budget. Salaries are included in Analytics and the live preview
- **Payroll CSV (main admins only):** one row per member with phone, bank, branch, account holder, **full account number**, salary, work amount, total to pay and a TOTAL row — ready for making payments. Set `PAYROLL_CSV_INCLUDES_FULL_ACCOUNT_NUMBER = false` in `lib/config.ts` to export masked numbers instead
- **Payments (main admins only):** close a month when all its work is reviewed. Closing locks that month's work (nobody can add, change or delete it) and creates a **payslip** for every member with a salary or approved work, using the amounts at that moment. Then mark members as **paid** one by one or all at once, with the date and a bank reference. A month can be reopened while nobody in it is marked as paid. A warning shows when a member changed their bank details after the month was closed
- **Payslips:** members open and download their own payslips as PDF in **My payslips** (salary lines, work lines with quantity × rate, total, paid date and reference, masked bank account). Main admins can open anyone's payslip from Payments. Turn off member access with `MEMBERS_CAN_SEE_PAYSLIPS` in `lib/config.ts`
- **Activity log (main admins only):** every approval and rejection, rate, salary, budget and role change, bank detail change, member activation/deactivation, admin change, password reset, month close/reopen, payment and payroll CSV download is recorded with who did it and when. The database writes the log itself (triggers), so it can't be skipped, edited or deleted from the app. Search and filter by type, person and month
- **Two-step login:** anyone can turn on an authenticator app (Google Authenticator, Microsoft Authenticator…) in **Two-step login**. It is **required for main admins**: Analytics, Payments, Rates & budget, the Activity log and the payroll CSV only open after the 6-digit code was entered, and the database enforces this too. Main admins can reset another person's two-step login if they lose their phone
- **Notifications:** a bell in the top bar (live updates) and a Notifications page. Members are told when their work is approved or rejected, when their payslip is ready and when they are paid, about new notices, new roles and salary changes, and about deadlines. Admins get one grouped "N submissions waiting for review" message and a note when a month's deadline has passed. The database creates the messages itself
- **Monthly work deadline:** members must log a month's work by a set day of the next month (default: the 3rd). Reminders start a few days before (default 3) and a countdown card shows on the member dashboard. After the deadline members can't add or change that month's work; admins still can. Main admins change the rule in **Payments → Deadline** and can give a single month more time with **Change deadline**
- **Batches, exams & centres:** admins keep a list of A/L batches (e.g. “2026 A/L”), their exams/tests (e.g. “Term Test 2”) and class centres (e.g. “Kandy hall”) in **Batches & exams**. Members can tag work with an exam and a centre, and **Monthly report → By exam** shows approved work per test and role (e.g. papers marked for Term Test 2), filtered by batch and centre
- **Tasks:** admins assign a task (member, optional role, exam, centre, quantity, due date, high priority) in **Tasks**. The member is notified, sees it in **My tasks** and on the dashboard, logs work against it (**Log work** fills in the form) and marks it done. Reminders are sent the day before and on the due date, and once when it is overdue. Admins are told when a task is finished
- **Paper production tracker:** in **Papers**, admins add a paper or tute for an exam and choose an owner and due date for each stage: Create → Type set → Convert to English → Mark (stages can be skipped). Each stage becomes a task for its owner. When one stage is marked done the next starts and its owner gets a “Your turn” notification; when every stage is done the paper is finished. Each paper page shows the stepper, who has it now, overdue stages and the files for every stage with **version numbers** (v1, v2…; private storage, 25 MB per file). Stage owners can see and upload files only for their papers
- **Notice board:** admins post notices (pinned / with an end date); members see them on their dashboard
- **Quick search:** press Ctrl/⌘ + K anywhere to jump to a page or switch the theme
- **Work types and amounts:** when a role has rates, members pick the type of work (e.g. Flyer); amount = quantity × rate. The price is locked when the work is approved, so later price changes don't rewrite history. Members see their own estimated earnings (turn off with `SHOW_MEMBERS_THEIR_EARNINGS` in `lib/config.ts`)
- **Log again:** start a new submission from an earlier one in one tap
- Birthdays: a banner on admin pages on the day, an "Upcoming birthdays" card on the overview, and a 🎂 next to the member's name

**UI**: sidebar layout (different menus for members and admins), light/dark/system theme, works on phones, loading skeletons, empty states and toast messages.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**. Pick a region close to Sri Lanka (e.g. Singapore / Mumbai) and save the database password.
2. When it is ready, open **Project Settings → API** and copy:
   - **Project URL**
   - **anon / publishable** key
   - **service_role / secret** key (keep this private)

## 2. Run the migrations and seed

The schema lives in [`supabase/migrations`](supabase/migrations) and the starter data in [`supabase/seed.sql`](supabase/seed.sql).

| File | What it does |
| --- | --- |
| `20261026000001_schema.sql` | Tables, triggers, helper functions, report view |
| `20261026000002_rls.sql` | Row Level Security on every table |
| `20261026000003_storage.sql` | Private `attachments` and `avatars` buckets + storage policies |
| `20261026000004_harden_functions.sql` | Stops anonymous visitors calling helper functions |
| `20261026000005_birthdays_and_rates.sql` | Date of birth from NIC, salaried roles, `rate_items` table |
| `20261026000006_analytics_payouts_notices.sql` | Main admins, work type + amount on submissions, monthly budget, notice board |
| `20261026000007_member_salaries.sql` | Fixed monthly salaries per member for salaried roles |
| `20261026000008_payments_activity_two_step.sql` | Closed months, payouts/payslips, activity log, two-step login for main admins |
| `20261026000009_notifications_deadlines.sql` | Notifications, monthly work deadline and daily reminders |
| `20261026000010_classes_tasks_papers.sql` | Batches, exams, centres, tasks, paper production tracker and the private `papers` bucket |
| `seed.sql` | Sections & roles, 4 sample members, sample submissions |

**Option A: Supabase SQL editor (no tools needed)**

Open **SQL Editor → New query**, paste each migration file **in order** (01 to 10) and press **Run**. Then do the same with `seed.sql`.

**Option B: Supabase CLI**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push            # runs the migrations
# then run supabase/seed.sql in the SQL editor (db push does not run seeds)
```

For a local Supabase stack (Docker), `npx supabase start` followed by `npx supabase db reset` runs the migrations **and** the seed.

> **Sample members:** the seed creates `nimal.perera@example.com`, `kavindi.silva@example.com`, `tharindu.fernando@example.com` and `sachini.jaya@example.com`, all with password `Password123!`. They are for trying the app out. Delete them in **Authentication → Users** before real use.

## 3. Configure Supabase Auth

In **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000` (later your real domain, e.g. `https://tracker.example.com`)
- **Redirect URLs**: add `http://localhost:3000/**` and `https://<your-domain>/**`

In **Authentication → Sign In / Providers** → Email: turn **off** "Allow new users to sign up". The team is invite-only; admins add members from the app.

**Recommended:** in **Authentication → Emails**, change the links so password-reset and invite emails also work when opened on a different device or browser:

- **Reset password** template link:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
- **Invite user** template link:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`

(The default templates also work, as long as the link is opened in the same browser that requested it.)

> The free Supabase email service only sends a few emails per hour. For a whole class, set up custom SMTP (**Project Settings → Authentication → SMTP**) or add members with **Set a password** instead of an invite.

## 4. Set the environment variables

```bash
cp .env.example .env.local
```

| Variable | Where it is used |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server. Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server. anon / publishable key (RLS protects data) |
| `NEXT_PUBLIC_SITE_URL` | Links in emails, e.g. `http://localhost:3000` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only.** Needed to invite/create and deactivate members |

The service role key is only read in [`lib/supabase/admin.ts`](lib/supabase/admin.ts), which imports `server-only`, so it can never end up in browser code. Never give it a `NEXT_PUBLIC_` prefix and never commit `.env.local`.

## 5. Run the app locally

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

Other scripts:

```bash
npm run lint        # ESLint
npm run typecheck   # route types + tsc --noEmit
npm run build       # production build
npm start           # run the production build
```

## 6. Create the first admin

There is no public sign-up, so the first admin is made by hand:

1. In Supabase go to **Authentication → Users → Add user → Create new user**. Enter your email and a password and tick **Auto Confirm User**. A profile row is created automatically.
2. In **SQL Editor**, run (with your own email):

   ```sql
   update public.profiles set is_admin = true, is_main_admin = true where email = 'you@example.com';
   ```

   `is_main_admin` makes you a **main admin** (owner): only main admins see **Analytics** and can change **Rates & budget**. Leave it out for ordinary admins.

3. Log in to the app. Main admins are asked to turn on **two-step login** first: install Google Authenticator or Microsoft Authenticator on your phone, scan the QR code and enter the 6-digit code. After that you will see every admin page.
4. You will see the **Admin** menu. From there, add the other members (and other admins) using **Members → Add member**.

### Two-step login

Supabase turns on authenticator apps (TOTP) by default. If setting it up says it is turned off, enable it in **Authentication → Multi-Factor → TOTP**.

**A main admin lost their phone:** the other main admin opens **Two-step login** and presses **Reset** next to their name (needs `SUPABASE_SERVICE_ROLE_KEY`). If no main admin can log in, run this in the Supabase **SQL Editor** (with the right email), then set it up again after logging in:

```sql
delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'you@example.com');
```

### Deadline reminders

Migration 09 schedules a daily job at 9:00 Sri Lanka time with **pg_cron** (Supabase → **Integrations → Cron** shows it as `team-deadline-reminders`). If pg_cron isn't available the reminders are still sent whenever someone opens their dashboard. Live updates for the bell use Supabase **Realtime**, which the migration turns on for the `notifications` table.

### Monthly payments

1. Review all of the month's work (**Work review**).
2. **Payments → Close month**. Payslips are created and the month's work is locked.
3. Download the **Payroll CSV**, make the bank transfers, then **Mark as paid** (date + reference).
4. Members see their payslips in **My payslips** and can download the PDF.

---

## Security

- **Row Level Security is on for every table.** Members can only read and write their own profile, bank details, roles (read-only) and submissions; admins (`is_admin = true` and active) can read and write everything. The anonymous role has no access at all.
- Database triggers also stop members from making themselves admin, changing review fields, or editing work after it was reviewed, even if someone calls the API directly.
- Bank details are in their own `bank_details` table. Pages only load the last 4 digits (`account_last4`); the full number is fetched by a server action only when the owner presses **Show**. To let admins reveal it too, set `ADMINS_CAN_REVEAL_ACCOUNT_NUMBER = true` in [`lib/config.ts`](lib/config.ts).
- Storage buckets are **private**. Files are stored under `<user id>/…` and opened through `/files/<id>`, which checks access and redirects to a signed URL that expires after 60 seconds.
- Every server action and route handler validates its input with Zod and re-checks who is signed in.
- Main-admin powers (rates, salaries, payments, payouts, the activity log) need a **two-step (aal2) session**: `is_main_admin()` checks the `aal` claim of the login token, so they can't be used with just a stolen password.
- The **activity log** and **payouts** can only be written by database functions; no user (not even a main admin) can insert, edit or delete rows directly. Work in a closed month is locked by a trigger.
- Deactivated members are signed out, cannot submit work (RLS), and are banned in Supabase Auth when the service role key is set.

## React Bits components

The React Bits registry (reactbits.dev) and the shadcn registry were blocked by the network when this was built, so the components were added by hand: shadcn/ui sources in [`components/ui`](components/ui) and React Bits sources (adapted to TypeScript + Tailwind) in [`components/reactbits`](components/reactbits):

| Component | Used for |
| --- | --- |
| **Aurora** (`aurora.tsx`, uses `ogl`) | Animated background on the login, forgot-password and reset-password pages |
| **BlurText** (`blur-text.tsx`, uses `motion`) | Animated headers on the login page and the member/admin dashboards |
| **CountUp** (`count-up.tsx`, uses `motion`) | Animated numbers on all stat cards |
| **SpotlightCard** (`spotlight-card.tsx`) | Hover glow and lift on stat cards, submission cards and section cards |
| **ShinyText** (`shiny-text.tsx`) | The app name in the sidebar |

All animations are short, and they turn off when the device has **Reduce motion** enabled (`prefers-reduced-motion`). Aurora then draws one still frame, and the text and numbers appear immediately.

To reinstall them from the registry later (when the network allows), for example:

```bash
npx shadcn@latest add https://reactbits.dev/r/BlurText-TS-TW
```

## Project structure

```
app/
  (auth)/            login, forgot-password, reset-password (Aurora background)
  (app)/             signed-in area with the sidebar
    dashboard, profile, bank, work/            member pages
    admin/                                     admin pages (guarded by requireAdmin)
  auth/confirm       email link handler · auth/signout
  files/[id]         private attachment → signed URL
components/
  ui/                shadcn/ui components
  reactbits/         React Bits components
  admin/, member/    feature components
lib/
  actions/           server actions (all inputs validated with Zod)
  supabase/          browser, server, proxy and service-role clients
  validation.ts      Zod schemas shared by forms and server actions
  database.types.ts  types for the database schema
proxy.ts             refreshes the session and protects private pages
supabase/
  migrations/        SQL migrations
  seed.sql           starter data
```

## Deploying (e.g. Vercel)

1. Import the repository in Vercel.
2. Add the four environment variables from step 4 (set `NEXT_PUBLIC_SITE_URL` to the real domain).
3. Add the domain to Supabase **Site URL** and **Redirect URLs**.
