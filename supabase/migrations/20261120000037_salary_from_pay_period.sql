-- =============================================================================
-- Fixed salaries count from the pay period they were set in.
-- A month's period runs to the 10th of the next month, but closing a month only
-- counted salaries set before the 1st of the next month: a salary set on
-- 5 November was left off October's payslip. Now the cut-off is the end of the
-- period (public.work_deadline: the first moment after the 10th, Sri Lanka time).
-- Otherwise the same as migration 026. Safe to run more than once.
-- =============================================================================

create or replace function public.close_pay_month(p_month date, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved integer;
  next_open date;
  created integer;
  total numeric(14, 2);
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can close a month.' using errcode = '42501';
  end if;
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'Choose a month.' using errcode = 'P0001';
  end if;
  if public.colombo_today() <= public.pay_period_last_day(p_month) then
    raise exception '% runs until %. You can close it from the next day.',
      public.month_name(p_month), to_char(public.pay_period_last_day(p_month), 'FMDD Mon YYYY')
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.pay_months where month = p_month) then
    raise exception '% is already closed.', public.month_name(p_month) using errcode = 'P0001';
  end if;

  -- Work that isn't approved moves on, so it can still be reviewed and paid later.
  next_open := (p_month + interval '1 month')::date;
  while exists (select 1 from public.pay_months where month = next_open) loop
    next_open := (next_open + interval '1 month')::date;
  end loop;
  perform set_config('app.moving_pay_period', 'on', true);
  update public.submissions set work_month = next_open where work_month = p_month and status <> 'approved';
  get diagnostics moved = row_count;
  perform set_config('app.moving_pay_period', 'off', true);

  insert into public.pay_months (month, closed_by, note)
  values (p_month, (select auth.uid()), nullif(trim(p_note), ''));

  with work_groups as (
    select
      sub.user_id,
      sub.role_id,
      r.name as role_name,
      ri.name as item_name,
      ri.unit,
      sub.unit_price,
      count(*)::integer as items,
      sum(sub.quantity)::integer as quantity,
      coalesce(sum(sub.amount), 0)::numeric(14, 2) as amount
    from public.submissions sub
    join public.roles r on r.id = sub.role_id
    left join public.rate_items ri on ri.id = sub.rate_item_id
    where sub.work_month = p_month and sub.status = 'approved'
    group by sub.user_id, sub.role_id, r.name, ri.name, ri.unit, sub.unit_price
  ),
  work as (
    select
      user_id,
      jsonb_agg(
        jsonb_build_object(
          'role_id', role_id, 'role', role_name, 'item', item_name, 'unit', unit,
          'items', items, 'quantity', quantity, 'unit_price', unit_price, 'amount', amount
        )
        order by role_name, item_name nulls last
      ) as lines,
      sum(amount) as amount,
      sum(items)::integer as items,
      sum(quantity)::integer as units
    from work_groups
    group by user_id
  ),
  -- Same rule as Analytics: salaried role, still held, active member, set before the period ended.
  salary_groups as (
    select ms.user_id, ms.role_id, r.name as role_name, ms.monthly_amount::numeric(14, 2) as amount
    from public.member_salaries ms
    join public.roles r on r.id = ms.role_id and r.is_salaried
    join public.member_roles mr on mr.user_id = ms.user_id and mr.role_id = ms.role_id
    join public.profiles p on p.id = ms.user_id and p.is_active
    where ms.monthly_amount > 0 and ms.created_at < public.work_deadline(p_month)
  ),
  salary as (
    select
      user_id,
      jsonb_agg(jsonb_build_object('role_id', role_id, 'role', role_name, 'amount', amount) order by role_name) as lines,
      sum(amount) as amount
    from salary_groups
    group by user_id
  ),
  people as (
    select user_id from work
    union
    select user_id from salary
  ),
  numbered as (
    select
      pe.user_id,
      row_number() over (order by lower(coalesce(nullif(trim(p.full_name), ''), p.email)), p.id) as n
    from people pe
    join public.profiles p on p.id = pe.user_id
  )
  insert into public.payouts (
    month, payslip_no, user_id, member_name, member_email, member_phone, member_nic,
    bank_name, bank_branch, account_holder, account_last4,
    salary_amount, work_amount, approved_items, approved_units, salary_lines, work_lines
  )
  select
    p_month,
    'PS-' || to_char(p_month, 'YYYYMM') || '-' || lpad(nb.n::text, 3, '0'),
    p.id,
    coalesce(nullif(trim(p.full_name), ''), p.email),
    p.email,
    p.phone,
    p.nic,
    b.bank_name,
    b.branch,
    b.account_holder,
    b.account_last4,
    coalesce(s.amount, 0),
    coalesce(w.amount, 0),
    coalesce(w.items, 0),
    coalesce(w.units, 0),
    coalesce(s.lines, '[]'::jsonb),
    coalesce(w.lines, '[]'::jsonb)
  from numbered nb
  join public.profiles p on p.id = nb.user_id
  left join public.bank_details b on b.user_id = p.id
  left join work w on w.user_id = p.id
  left join salary s on s.user_id = p.id;

  get diagnostics created = row_count;
  select coalesce(sum(total_amount), 0) into total from public.payouts where month = p_month;

  perform public.write_activity('month.closed', 'month', p_month::text, null,
    'Closed ' || public.month_name(p_month) || ' for payments: ' || created || ' member'
      || case when created = 1 then '' else 's' end || ', ' || public.lkr(total) || ' to pay',
    jsonb_build_object('month', p_month, 'members', created, 'total', total, 'note', nullif(trim(p_note), ''),
                       'moved_to_next', moved));
  return created;
end;
$$;
