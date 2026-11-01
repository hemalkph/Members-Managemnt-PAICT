-- =============================================================================
-- Pay periods: a "month" runs from the 11th to the 10th of the next month and
-- is named after the month it starts in ("October 2026" = 11 Oct – 10 Nov).
-- Safe to run more than once.
--
-- * The database decides each work's month (members no longer pick it):
--   new work, and pending work when edited, goes to the current month;
--   approving work puts it in the month of the approval date (Sri Lanka time).
-- * A month that ended but wasn't closed stays open and can still be closed;
--   work approved after its 10th already counts for the next month.
-- * Closing is allowed once the period has ended (from the 11th). Work in it
--   that isn't approved moves on to the next open month.
-- * The old "submit by day N" deadline is replaced by the period end (the
--   10th). Members can always log work; reminders come before the 10th.
-- * One-off: work in months that are not closed moves into the current month
--   (runs once, recorded in app_settings.pay_periods_from).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Period helpers
-- -----------------------------------------------------------------------------
create or replace function public.colombo_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Colombo')::date;
$$;

-- The month a day belongs to: 11 Oct – 10 Nov → 2026-10-01.
create or replace function public.pay_period_of(p_day date)
returns date
language sql
immutable
set search_path = ''
as $$
  select date_trunc('month', p_day - 10)::date;
$$;

-- The last day of a month's period: 2026-10-01 → 10 Nov 2026.
create or replace function public.pay_period_last_day(p_month date)
returns date
language sql
immutable
set search_path = ''
as $$
  select ((p_month + interval '1 month')::date + 9);
$$;

-- The month for work on this day, skipping months that are already closed.
create or replace function public.open_pay_period(p_day date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m date := public.pay_period_of(p_day);
begin
  while exists (select 1 from public.pay_months where month = m) loop
    m := (m + interval '1 month')::date;
  end loop;
  return m;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. The database sets each work's month
-- -----------------------------------------------------------------------------
create or replace function public.assign_pay_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- SQL editor / service role, and close_pay_month moving work on, are trusted.
  if (select auth.uid()) is null or current_setting('app.moving_pay_period', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT'
     or (new.status = 'approved' and old.status is distinct from 'approved')
     or new.status = 'pending' then
    new.work_month := public.open_pay_period(public.colombo_today());
  else
    new.work_month := old.work_month;
  end if;
  return new;
end;
$$;

-- Fires first (triggers run in name order), before the closed-month check.
create or replace trigger submissions_0_pay_period
  before insert or update on public.submissions
  for each row execute function public.assign_pay_period();

-- -----------------------------------------------------------------------------
-- 3. Deadlines follow the period end
-- -----------------------------------------------------------------------------
-- When a month's period ends (the first moment after its 10th).
create or replace function public.work_deadline(p_month date)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select ((public.pay_period_last_day(p_month) + 1)::timestamp at time zone 'Asia/Colombo');
$$;

-- Work always goes to an open month now, so there is nothing left to block.
create or replace function public.guard_work_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return new;
end;
$$;

create or replace function public.set_month_deadline(p_month date, p_last_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Months now end on the 10th, so deadlines can''t be changed.' using errcode = 'P0001';
end;
$$;

create or replace function public.send_deadline_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings record;
  this_month date := public.pay_period_of(public.colombo_today());
  m date;
  due timestamptz;
  days_left integer;
  sent integer := 0;
  pending_count integer;
  person record;
begin
  perform public.send_task_reminders();
  select * into settings from public.app_settings limit 1;

  foreach m in array array[(this_month - interval '1 month')::date, this_month] loop
    continue when exists (select 1 from public.pay_months where month = m);
    due := public.work_deadline(m);
    continue when due is null;

    if now() < due then
      days_left := ceil(extract(epoch from (due - now())) / 86400)::integer;
      continue when days_left > coalesce(settings.reminder_days, 3);
      for person in
        select distinct p.id
        from public.profiles p
        join public.member_roles mr on mr.user_id = p.id
        where p.is_active
      loop
        perform public.notify(
          person.id, 'deadline.reminder',
          'Get your ' || public.month_name(m) || ' work in by ' || public.deadline_label(due),
          case when days_left <= 1 then 'Last day today! '
               else days_left || ' days left. ' end
            || 'Work approved after that counts for next month.',
          '/work/new',
          'deadline:' || public.month_key(m) || ':' || days_left
        );
        sent := sent + 1;
      end loop;
    elsif now() < due + interval '10 days' then
      select count(*) into pending_count from public.submissions where work_month = m and status = 'pending';
      for person in select id from public.profiles where is_admin and is_active loop
        perform public.notify(
          person.id, 'deadline.passed',
          public.month_name(m) || ' has ended – close it in Payments',
          case when pending_count > 0
            then pending_count || ' submission' || case when pending_count = 1 then '' else 's' end
                 || ' still waiting for review will move to next month when you close it.'
            else 'Everything is reviewed. Close the month in Payments.' end,
          case when pending_count > 0
            then '/admin/review?status=pending&month=' || public.month_key(m)
            else '/admin/payments?month=' || public.month_key(m) end,
          'deadline-passed:' || public.month_key(m)
        );
        sent := sent + 1;
      end loop;
    end if;
  end loop;
  return sent;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Closing a month
-- -----------------------------------------------------------------------------
-- Close a month once its period has ended (from the 11th). Work in it that isn't
-- approved moves on to the next open month. Snapshots what each member is owed
-- (fixed salaries + approved work) into payouts. Otherwise the same as migration 008.
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
  -- Same rule as Analytics: salaried role, still held, active member, set before the month ended.
  salary_groups as (
    select ms.user_id, ms.role_id, r.name as role_name, ms.monthly_amount::numeric(14, 2) as amount
    from public.member_salaries ms
    join public.roles r on r.id = ms.role_id and r.is_salaried
    join public.member_roles mr on mr.user_id = ms.user_id and mr.role_id = ms.role_id
    join public.profiles p on p.id = ms.user_id and p.is_active
    where ms.monthly_amount > 0 and ms.created_at < (p_month + interval '1 month')
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

-- -----------------------------------------------------------------------------
-- 5. One-off: move work in months that are not closed into the current month
-- -----------------------------------------------------------------------------
alter table public.app_settings add column if not exists pay_periods_from date;

do $$
declare
  current_month date := public.open_pay_period(public.colombo_today());
begin
  if (select pay_periods_from from public.app_settings limit 1) is not null then
    return;
  end if;
  update public.submissions s
     set work_month = current_month
   where s.work_month <> current_month
     and not exists (select 1 from public.pay_months pm where pm.month = s.work_month);
  update public.app_settings set pay_periods_from = current_month where id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Permissions
-- -----------------------------------------------------------------------------
revoke execute on function public.assign_pay_period() from public, anon, authenticated;
revoke execute on function public.open_pay_period(date) from public, anon;
grant execute on function public.open_pay_period(date) to authenticated;
