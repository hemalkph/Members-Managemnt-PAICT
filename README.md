# Team Work Tracker

A web app for the A/L ICT class team. **Members** log the work they do each month; **admins** manage members, sections and roles, and review the work.

Built with Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui · React Bits · Supabase (Auth, Postgres, Storage) · Zod + react-hook-form.

---

## Features

**Members**
- Log in / log out / forgot password (email link → set a new password)
- Profile: full name, phone, WhatsApp, NIC (optional), profile photo, assigned roles (read-only)
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
| `seed.sql` | Sections & roles, 4 sample members, sample submissions |

**Option A: Supabase SQL editor (no tools needed)**

Open **SQL Editor → New query**, paste each migration file **in order** (01, 02, 03) and press **Run**. Then do the same with `seed.sql`.

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
   update public.profiles set is_admin = true where email = 'you@example.com';
   ```

3. Log in to the app. You will see the **Admin** menu. From there, add the other members (and other admins) using **Members → Add member**.

---

## Security

- **Row Level Security is on for every table.** Members can only read and write their own profile, bank details, roles (read-only) and submissions; admins (`is_admin = true` and active) can read and write everything. The anonymous role has no access at all.
- Database triggers also stop members from making themselves admin, changing review fields, or editing work after it was reviewed, even if someone calls the API directly.
- Bank details are in their own `bank_details` table. Pages only load the last 4 digits (`account_last4`); the full number is fetched by a server action only when the owner presses **Show**. To let admins reveal it too, set `ADMINS_CAN_REVEAL_ACCOUNT_NUMBER = true` in [`lib/config.ts`](lib/config.ts).
- Storage buckets are **private**. Files are stored under `<user id>/…` and opened through `/files/<id>`, which checks access and redirects to a signed URL that expires after 60 seconds.
- Every server action and route handler validates its input with Zod and re-checks who is signed in.
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
