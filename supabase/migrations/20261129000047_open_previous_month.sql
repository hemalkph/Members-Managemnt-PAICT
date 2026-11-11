-- =============================================================================
-- Work goes to last month until it is closed. Safe to run twice.
--
-- * While last month isn't closed, new work and work approved now count for
--   last month (e.g. on 11 Nov, October until you close it). Once it is
--   closed, work goes to the current month, as before.
-- * Months before pay periods started (app_settings.pay_periods_from) are never
--   used, and a member paid from next month still waits for that month.
-- * One-off: pending work already filed under the current month moves back to
--   last month, so it shows up when reviewing it.
-- =============================================================================

create or replace function public.member_open_pay_period(p_user uuid, p_day date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cur date := public.pay_period_of(p_day);
  prev date := (cur - interval '1 month')::date;
  m date := cur;
begin
  if prev >= coalesce((select pay_periods_from from public.app_settings limit 1), cur)
     and not exists (select 1 from public.pay_months where month = prev) then
    m := prev;
  end if;
  m := greatest(m, coalesce((select from_month from public.member_pay_starts where user_id = p_user), '-infinity'::date));
  while exists (select 1 from public.pay_months where month = m) loop
    m := (m + interval '1 month')::date;
  end loop;
  return m;
end;
$$;

-- Same rule for anyone without a pay start month.
create or replace function public.open_pay_period(p_day date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select public.member_open_pay_period(null, p_day);
$$;

-- One-off (no-op on a re-run): pending work moves back to the open month.
update public.submissions s
   set work_month = public.member_open_pay_period(s.user_id, public.colombo_today())
 where s.status = 'pending'
   and s.work_month > public.member_open_pay_period(s.user_id, public.colombo_today());
