# Salary Receipts over WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a main admin pays a member, they can send that member a WhatsApp receipt in one tap. Its link opens a public receipt page that can't be faked and needs no login.

**Architecture:**
- **Migration 083** adds a random `payouts.receipt_token`. It also adds an anon-callable `payout_receipt(token)` that returns only the message's fields, and only while the payout is paid.
- **Pure helpers** in `lib/payments/receipt.ts` build the message text and the link.
- **A public `/receipt/[token]` route** has a generic preview image and is exempt from the login and idle checks in the proxy.
- **The Payments page** gets a WhatsApp button for each paid row, plus a step-through dialog after "Mark as paid".

**Tech Stack:** Next.js 16.4 (App Router, `next/og`), Supabase Postgres, shadcn/ui, sonner, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-salary-receipts-design.md`

## Global Constraints

- **Branch:** `feature/salary-receipts` from origin/main (18c58ed).
- **Migration file:** `supabase/migrations/20270104000083_salary_receipts.sql`. Use the next free number if Phase 6 took 083.
  - It must be safe to run twice. Functions are `security definer`, with `search_path = ''`.
  - The owner pastes it into the SQL Editor.
- **Next.js:** read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md` and the `generateMetadata` docs before Task 3.
- **The public page and lookup expose only:** first name, month, payslip number, salary, work amount, number of work items, total, paid on, reference. Never bank details, NIC, email, phone, full name or work lines.
- **Invalid, unknown or unpaid links** all show the same card: "This receipt is no longer valid".
- **Preview card:** "PAICT" and "Salary receipt" only. No name and no amounts.
- **Message copy** (exact, with lines left out when they don't apply):
  ```
  Hi {first}, your salary for {Month YYYY} has been paid! 🎉

  Salary: {LKR}
  Work: {LKR} ({n} items)
  *Total: {LKR}*

  Reference: {reference}
  Paid on: {DD/MM/YYYY}
  Payslip No.: {payslip_no}

  View your receipt: {siteUrl}/receipt/{token}
  Thank you for your work! 🙏
  ```
  - "1 item" for one.
  - No Salary line when the salary is 0, no Work line when work is 0, no Reference line when there's no reference.
- **Phone:** `profiles.whatsapp`, else `profiles.phone`, else `payouts.member_phone`, run through `normalizeWaPhone()`.
- **No commits until the owner says "yes, push".** Then one commit under the owner's name, with no AI lines.

## Review Focus

1. **A member who once signed in on their phone, and whose session has gone idle,** opens the link. They should see the receipt, not be signed out. *(Task 3: `idle-expired visitor still sees /receipt`)*
2. **Marked paid, then marked not paid:** the link shows "no longer valid" straight away. *(Task 1: `stops after mark not paid`)*
3. **Paid again with a new reference:** the same link shows the new reference and date. *(Task 1: `shows the latest payment`)*
4. **A garbage or cut-off link** (`/receipt/abc`, a truncated UUID) shows the invalid card, not a 500 error. *(Task 3: `isReceiptToken`)*
5. **A bulk payment that includes zero-total members or members with no number:** the dialog leaves out zero totals and shows "No number" with only Skip. *(Task 4: `receiptQueue`)*

---

### Task 1: Migration 083 and DB tests

**Files:**
- Create: `supabase/migrations/20270104000083_salary_receipts.sql`
- Test: `tests/db/salary-receipts.test.ts`
- Modify: `lib/supabase/database.types.ts`: add `receipt_token: string` to `payouts.Row`, and add `payout_receipt` to `Functions`

**Interfaces (produces):**
- Column `public.payouts.receipt_token uuid not null default gen_random_uuid()`, with a unique index `payouts_receipt_token_key`. Use `add column if not exists`, and create the index only if it's missing.
- `public.payout_receipt(p_token uuid) returns table (first_name text, month date, payslip_no text, salary_amount numeric, work_amount numeric, approved_items integer, total_amount numeric, paid_on date, payment_reference text)`:
  - `stable`, `security definer`, `search_path = ''`
  - `first_name = split_part(trim(member_name), ' ', 1)`
  - rows only where `receipt_token = p_token and status = 'paid' and total_amount > 0`
  - `revoke ... from public`, then `grant execute ... to anon, authenticated`
  - Match the existing column types of `payouts` (check with `\d public.payouts` in the test DB). Don't guess numeric vs integer.

- [ ] **Step 1: Write the failing tests.** Build the setup like `tests/db/pay-periods.test.ts`: a main admin (aal2), a member with a role and approved work, then close the month so a payout exists. Tests:
  - `every payout has a distinct token`: `count(distinct receipt_token) = count(*)` on `payouts`.
  - `nothing while unpaid`: as `{ kind: "anon" }`, `payout_receipt(token)` returns 0 rows.
  - `paid receipt shows only the message fields`: as main, `set_payouts_paid(array[id], true, current_date, 'BOC 4581')`. Then as anon, one row comes back:
    - `payment_reference = 'BOC 4581'` and `first_name` = the first word of the name
    - `Object.keys(row)` equals exactly the nine columns above
  - `stops after mark not paid`: `set_payouts_paid(array[id], false)`, then 0 rows.
  - `shows the latest payment`: pay again with `'Sampath 77'` and yesterday's date. The row shows the new reference and date.
  - `zero total gives nothing`: a payout with `total_amount = 0` that's marked paid returns 0 rows. Create it via a member with no work, or skip this if closing never creates zero rows; check `close_pay_month`.
  - `anon still cannot read payouts`: as anon, `select count(*) from public.payouts` gives 0 or permission denied (use `outcome()`).
  - `migration runs twice`: as owner, run the migration file's SQL a second time without an error.
- [ ] **Step 2: Run and see them fail.** `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 PG_BIN=/opt/homebrew/bin npm run test:db -- salary-receipts`. Expected: FAIL (`column "receipt_token" does not exist`).
- [ ] **Step 3: Write the migration.** Start with a header comment in the style of `20270103000082_review_limit.sql`.
- [ ] **Step 4: Run them and see them pass.** Same command. Expected: all pass. Also run the full `test:db` and expect no regressions.
- [ ] **Step 5: Update `database.types.ts`** by hand, in the file's existing style. Then `npm run typecheck` passes.

---

### Task 2: Receipt text and link helpers

**Files:**
- Create: `lib/payments/receipt.ts` (no `server-only`: the client dialog imports it)
- Modify: `lib/core/format.ts`: add `formatDateNumeric`
- Test: `tests/unit/salary-receipt.test.ts`

**Interfaces (produces):**
- `formatDateNumeric(value: string | null | undefined): string`: `"2026-11-25"` → `"25/11/2026"`. Null or invalid → `"—"`.
- ```ts
  export type ReceiptInput = {
    memberName: string; monthKey: string; payslipNo: string;
    salary: number; work: number; items: number; total: number;
    paidOn: string; reference: string | null; token: string;
  };
  export function receiptUrl(siteUrl: string, token: string): string;          // `${siteUrl}/receipt/${token}`
  export function receiptWhatsAppText(r: ReceiptInput, siteUrl: string): string; // exact copy from Global Constraints
  export function isReceiptToken(value: string): boolean;                       // UUID shape check, reuse `uuid` from lib/core/validation
  ```

- [ ] **Step 1: Write the failing tests:**
  - `formatDateNumeric`: `"2026-11-25"` → `"25/11/2026"`; `null` → `"—"`.
  - `full receipt`: salary 15000, work 9500, items 7, reference "BOC transfer 4581". The text equals the spec's sample exactly, with `formatLKR` amounts.
  - `salary only`: work 0 means no `Work:` line. `work only`: salary 0 means no `Salary:` line.
  - `no reference` means no `Reference:` line. `one item` reads `(1 item)`.
  - `first name`: `"  Kasun Perera "` → `Hi Kasun,`.
  - `isReceiptToken`: true for a UUID; false for `"abc"`, `""` and a UUID with its last character cut off.
- [ ] **Step 2:** `npx vitest run tests/unit/salary-receipt.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement the helpers.** Build the message as an array of lines joined with `"\n"`, like `taskWhatsAppText` in `lib/tasks/whatsapp.ts`.
- [ ] **Step 4:** Run the same command. Expected: PASS.

---

### Task 3: The public receipt page, proxy exemption and preview card

**Files:**
- Create: `app/receipt/[token]/page.tsx`, `app/receipt/opengraph-image.tsx`, `app/receipt/layout.tsx` (a bare centred layout; no sidebar or app shell)
- Modify: `lib/supabase/proxy.ts`: add `"/receipt"` to `PUBLIC_PATHS`, and skip the idle redirect for it
- Modify: `app/layout.tsx`: add `metadataBase: new URL(getSiteUrl())`
- Test: `tests/unit/proxy.test.ts` (add cases)

**Interfaces:**
- Consumes `isReceiptToken`, `formatDateNumeric` and the DB function `payout_receipt`.
- In `proxy.ts`: `const isReceipt = pathname === "/receipt" || pathname.startsWith("/receipt/")`. Add `&& !isReceipt` to the idle-redirect condition. Leave the idle-cookie refresh alone.

- [ ] **Step 1: Write the failing proxy tests:**
  - `signed-out visitor sees /receipt`: no claims, `/receipt/<uuid>` → status 200.
  - `idle-expired visitor still sees /receipt`: claims set and an expired `LAST_ACTIVE_COOKIE` → status 200, with no `location` header.
  - `idle-expired visitor is still signed out elsewhere`: the same cookies on `/dashboard` → 307 to `/auth/signout`.
- [ ] **Step 2:** `npx vitest run tests/unit/proxy.test.ts`. Expected: the first two FAIL.
- [ ] **Step 3: Change `proxy.ts`.** Then run the same command and expect PASS.
- [ ] **Step 4: Build the page.**
  - `generateMetadata` returns title "Salary receipt", description `PAYSLIP_ORGANISATION` and `robots: { index: false, follow: false }`. It doesn't read the database, so it never leaks.
  - The page checks `isReceiptToken(token)`, then calls `(await createClient()).rpc("payout_receipt", { p_token: token }).maybeSingle()`.
  - With a row, it shows the receipt card from the spec: logo `/logo.png`, "PA ICT – Salary receipt", a Paid badge, `{first} · {monthLabel}`, Salary / Work (N items) / Total, Reference · Paid on, Payslip No. It reuses `Card` and `Badge`.
  - Anything else shows the same "This receipt is no longer valid" card.
  - No links. No coloured left-border strips. Check light and dark.
- [ ] **Step 5: Build `opengraph-image.tsx`.** Use `ImageResponse` at 1200×630, with the logo, "PAICT" and "Salary receipt", and `alt = "PAICT salary receipt"`. Place it so `/receipt/<token>` pages inherit it. Check the docs for segment inheritance; if it isn't inherited, move it into `[token]` with a static `alt`.
- [ ] **Step 6: Browser check** in the built-in browser against `npm run dev`. Use a real token from a test payout, read via SQL as the owner:
  - Signed out, the receipt shows.
  - `/receipt/abc` shows the invalid card.
  - View the source: `og:image` is an absolute URL, and there's a `noindex` robots meta.
  - The `og:image` URL itself returns a PNG while signed out.

---

### Task 4: Payments page: WhatsApp button and send queue

**Files:**
- Modify: `app/(app)/admin/payments/page.tsx` (closed-month branch, around line 195): read `profiles(id, whatsapp, phone)` for `ids`, and fill the new row fields
- Modify: `components/payments/payouts-table.tsx`: the new `PayoutRow` fields, the button, the menu item and the queue dialog wiring
- Modify: `components/payments/mark-paid-dialog.tsx`: `onDone` passes `{ paidOn, reference }`
- Create: `components/payments/receipt-queue-dialog.tsx`
- Modify: `lib/payments/receipt.ts`: add `receiptQueue`
- Test: `tests/unit/salary-receipt.test.ts` (add cases)

**Interfaces:**
- `PayoutRow` gains `monthKey: string`, `receiptToken: string` and `waPhone: string | null` (already normalised).
- `MarkPaidDialog`'s `onDone: (paid: { paidOn: string; reference: string | null }) => void`.
- `receiptQueue(rows: PayoutRow[]): PayoutRow[]`: leaves out `total <= 0` and keeps the given order.
  - Put it in `lib/payments/receipt.ts`, typed with a `Pick<…>`, so it doesn't import from `components/`.
- `ReceiptQueueDialog({ rows, paid, open, onOpenChange }: { rows: PayoutRow[]; paid: { paidOn: string; reference: string | null } | null; open: boolean; onOpenChange: (open: boolean) => void })`:
  - `paid` overrides each row's `paidOn` and `reference`, because the refresh hasn't arrived yet.
  - With `null`, it uses the row's own values (for single sends from a paid row).

- [ ] **Step 1: Write the failing test.** `receiptQueue` drops zero-total rows and keeps order: given totals `[100, 0, 50]`, it returns the 100 row then the 50 row.
- [ ] **Step 2:** `npx vitest run tests/unit/salary-receipt.test.ts`. Expected: FAIL. Then implement it, run again and expect PASS.
- [ ] **Step 3: Page data.**
  - One `profiles` read for `ids`, next to the `bank_details` read.
  - `waPhone = normalizeWaPhone(profile?.whatsapp || profile?.phone || p.member_phone)`.
  - `monthKey = month`. `receiptToken = p.receipt_token`.
- [ ] **Step 4: Table.**
  - Paid rows with `total > 0` get a small WhatsApp icon button next to the badge. It's an `<a target="_blank" rel="noreferrer">` to `whatsAppLink(waPhone, receiptWhatsAppText(…, getSiteUrl()))`.
  - They also get a menu item, "Send receipt on WhatsApp".
  - When `waPhone` is null, the button is disabled with the tooltip "No WhatsApp number", and the menu item is disabled.
- [ ] **Step 5: Queue dialog.**
  - After a successful "Mark as paid", open `ReceiptQueueDialog` with `receiptQueue(the rows just paid)` and the submitted `{ paidOn, reference }`.
  - It shows one member at a time: name, total, a `WhatsAppPreview` of the text (reuse `components/fees/whatsapp-preview.tsx` if its props fit), and "N of M".
  - Buttons: **Open WhatsApp** (opens the link in a new tab, then moves to the next) and **Skip**. With no number, it shows "No number" and only Skip.
  - At the end: "Done: N opened, M skipped" and a Close button.
  - Don't open it when the queue is empty.
- [ ] **Step 6: Browser check** at phone width and desktop width, against a closed test month:
  - Mark two members paid. The queue opens, the text matches the copy, and Open WhatsApp moves forward.
  - A paid row's button opens `api.whatsapp.com/send/?phone=94…`.
  - A member with no number shows a disabled button.

---

### Task 5: Finish

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, the full `test:db` command from Task 1, and `npm run build` all pass.
- [ ] Give the owner the migration SQL to paste into the Supabase SQL Editor. After they say "done", check with read-only queries:
  - `select count(*) filter (where receipt_token is null) from payouts` returns 0.
  - `select has_function_privilege('anon', 'public.payout_receipt(uuid)', 'execute')` is true.
- [ ] Remind them that `NEXT_PUBLIC_SITE_URL` must be the live site in Vercel, or the receipt links will point at localhost.
- [ ] Report what changed, and wait for "yes, push". Then make one commit under the owner's name.
