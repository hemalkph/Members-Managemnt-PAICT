# Salary receipts over WhatsApp: design

**Date:** 2026-11-26 · **Status:** approved in conversation. Builder check done; its two findings are folded in below.

## Why

Members don't open the app. They live on WhatsApp. The in-app "You have been paid Rs. X" notice (trigger `notify_payouts`) doesn't reach them in practice. When a main admin pays a member's salary, the member should get a receipt in WhatsApp, like the student receipts the main LMS sends. The message itself is the receipt. The link opens a page that shows the same receipt, with no login.

## Goals

- On **Admin → Payments**, every paid row with a total above zero has a **WhatsApp** button. It opens WhatsApp with the receipt already typed, and the admin presses send.
- After **Mark N as paid**, a step-through dialog sends receipts one by one: "Send to Kasun → Next → …", with Skip.
- The link in the message opens a **public receipt page** with no login. It shows only what the message shows.
- In WhatsApp, the link shows a branded preview card.

## Non-goals

- Sending automatically (WhatsApp Business API). Rejected: it needs Meta verification, approved templates and a fee per message.
- Tracking whether a receipt was sent.
- Receipts for student fees.
- Changing the existing payslip page, PDF or in-app notice.

## Anti-goals (a failure even if it works)

- **A receipt that can be faked or changed by editing the link.** The LMS link base64-encodes the data in `?d=`, so anyone can rewrite the amount. Ours must not work that way.
- **The public page showing more than the message:** bank details, NIC, email, full name, work line items, or links into the app.
- **The page still showing "Paid" after the admin marked it not paid.**
- **Amounts in the link preview.** WhatsApp and other apps cache preview cards.

## Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | A "Send receipt" button that opens a filled-in WhatsApp chat, plus a step-through dialog after bulk paying | The admin presses send for each person. Free, reuses `whatsAppLink()` and the fees queue pattern | **Picked** |
| B | WhatsApp Business Cloud API, sent automatically when marked paid | Meta verification, a separate number, template approval, a cost per message | Rejected |
| C | A public receipt page behind a secret code, added to A | Anyone the link is forwarded to sees that one receipt | **Picked, with A.** The owner wants members to see it without logging in, showing only what the message shows |

## Decisions

### Message (the owner agreed to this shape)

```
Hi Kasun, your salary for October 2026 has been paid! 🎉

Salary: Rs. 15,000
Work: Rs. 9,500 (7 items)
*Total: Rs. 24,500*

Reference: BOC transfer 4581
Paid on: 25/11/2026
Payslip No.: PS-2026-10-014

View your receipt: https://<site>/receipt/<code>
Thank you for your work! 🙏
```

- First name = the first word of `payouts.member_name`.
- The month uses `monthLabel(monthKey)`. Amounts use `formatLKR`. The date is numeric `DD/MM/YYYY`, as in the agreed message, not `formatDate`'s "25 Nov 2026". A small `formatDateNumeric` is added next to `formatDate` in `lib/core/format.ts`. *(my call, from the builder check)*
- A line is left out when it doesn't apply: no Salary line when the salary is 0, no Work line when work is 0, no Reference line when there is no reference. *(my call)*
- Built by a pure function so it can be unit-tested. The link is built with the existing `whatsAppLink()`, which keeps emojis intact.

### Phone number *(my call)*

Live `profiles.whatsapp`, else `profiles.phone`, else the snapshot `payouts.member_phone`. It's normalised with `normalizeWaPhone()` from `lib/fees/phone.ts`. When there's no usable number, the button is disabled with the tooltip "No WhatsApp number", and the dialog shows that member as "No number" and lets you skip.

### The secret code *(my call)*

- New column `payouts.receipt_token uuid not null default gen_random_uuid()`, unique. Existing rows get one when the column is added.
- It's a random value, not a signature. The page reads **live** data by the code, so nothing in the link can be edited. It also avoids a new server secret and the service-role client, which this codebase keeps for Auth admin tasks only.
- Main admins already read `payouts` with `select *`, so the code reaches the Payments page without a new query. A member can read their own row's code too, which is fine.

### Public lookup *(my call)*

`public.payout_receipt(p_token uuid)`: `security definer`, `stable`, `search_path = ''`, granted to `anon` and `authenticated`. It returns one row **only when `status = 'paid'` and `total_amount > 0`**:

`first_name, month, payslip_no, salary_amount, work_amount, approved_items, total_amount, paid_on, payment_reference`

Otherwise it returns nothing. "Mark as not paid" makes the link stop working straight away, and paying again brings it back with the new date and reference.

### Receipt page *(my call)*

- Route `app/receipt/[token]/page.tsx`, **outside** the `(app)` group, so no sidebar or login. `/receipt` is added to `PUBLIC_PATHS` in `lib/supabase/proxy.ts`.
- **Idle timeout:** the idle sign-out redirect in `proxy.ts` runs before the public-path check. Without a fix, a member who once signed in on their phone would be signed out instead of seeing the receipt. `/receipt` is exempt from the idle redirect, like `/auth/signout` and `/auth/confirm`. Their expired session is left alone, so the next private page still signs them out. *(my call, from the builder check)*
- Invalid UUID, no row, or not paid → the same "This receipt is no longer valid" card, so the page never says which.
- Layout: logo and "PA ICT – Salary receipt", a Paid badge, first name · month, Salary / Work (N items) / Total, then Reference · Paid on, then Payslip No. It follows the house look (no coloured left-border strips) and works in light and dark.
- Metadata: title "Salary receipt", description `PAYSLIP_ORGANISATION`, `robots: { index: false, follow: false }`.
- There's no "Log in" link: the page links nowhere.

### Preview card *(my call)*

- One generic `opengraph-image` (Next `ImageResponse`) with the logo, "PAICT" and "Salary receipt". **No amounts and no name.**
- It sits in the `receipt` segment so it's served under `/receipt/…`, which is public. The site's other OG metadata stays as it is.
- Add `metadataBase: new URL(getSiteUrl())` to the root layout so preview URLs are absolute.

### Payments page

- `PayoutRow` gains `receiptToken` and `waPhone`. `app/(app)/admin/payments/page.tsx` reads `whatsapp, phone` from `profiles` for the month's user ids, next to the existing `bank_details` read.
- Row actions menu: "Send receipt on WhatsApp" for paid rows. Also a small WhatsApp icon button on paid rows, so it takes one tap on phones.
- `MarkPaidDialog`'s `onDone` hands the paid rows to a new `ReceiptQueueDialog`. That dialog shows one member at a time: name, total, a message preview, **Open WhatsApp** (opens the link and moves to the next) and **Skip**. Then it shows "Done: N opened, M skipped". The paid date and reference come from what was just submitted, because `router.refresh()` hasn't finished yet.
- Who can send: main admins with two-step, the same as the page.

## Constraints

- Next.js 16.4: read `node_modules/next/dist/docs/` before writing route, metadata or OG code.
- Migration: the next free number in `supabase/migrations/` (083 unless Phase 6 has taken it). It must be safe to run twice. The owner pastes it into the SQL Editor. Dry-run it first with `npm run test:db` (`PG_BIN=/opt/homebrew/bin`, UTF-8 locale).
- Links use `getSiteUrl()`, so `NEXT_PUBLIC_SITE_URL` must be set in production. The task WhatsApp messages already depend on it.
- Branch `feature/salary-receipts` from origin/main. Nothing is committed or pushed until the owner says "yes, push". No AI attribution lines.

## Left to the builder

- Component file names, and whether the queue dialog shares code with `components/fees/whatsapp-queue-dialog.tsx`. Prefer a small new dialog over bending the fees one.
- The exact styling of the receipt card and OG image, within the house look.
- Test names and fixtures. Reuse the payout setup in `tests/db/pay-periods.test.ts`.
