-- =============================================================================
-- Salary receipts: admins send each paid member a WhatsApp receipt whose link
-- opens a public page (no login). Safe to run twice.
--
--   payouts.receipt_token        Random code in the link. Existing rows get one.
--   payout_receipt(token)        Anyone with the code: the message's fields, only
--                                while the payslip is marked paid and above zero.
--
-- The page reads live data by the code, so nothing in the link can be edited,
-- and "Mark as not paid" makes the link stop working straight away. It never
-- returns bank details, NIC, email, phone, full name or work lines.
-- =============================================================================

alter table public.payouts
  add column if not exists receipt_token uuid not null default gen_random_uuid();

create unique index if not exists payouts_receipt_token_key on public.payouts (receipt_token);

create or replace function public.payout_receipt(p_token uuid)
returns table (
  first_name        text,
  month             date,
  payslip_no        text,
  salary_amount     numeric,
  work_amount       numeric,
  approved_items    integer,
  total_amount      numeric,
  paid_on           date,
  payment_reference text
)
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(trim(p.member_name), ' ', 1), p.month, p.payslip_no, p.salary_amount, p.work_amount,
         p.approved_items, p.total_amount, p.paid_on, p.payment_reference
  from public.payouts p
  where p.receipt_token = p_token and p.status = 'paid' and p.total_amount > 0;
$$;

revoke execute on function public.payout_receipt(uuid) from public;
grant execute on function public.payout_receipt(uuid) to anon, authenticated;
