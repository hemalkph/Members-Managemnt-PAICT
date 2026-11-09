-- =============================================================================
-- Pay start month and salary changes from a chosen month. Safe to run twice.
--
-- * A member can be set to be paid from next month. Until then their salary
--   doesn't count, and their work (logged now or earlier, in months that are
--   not closed) goes to that month.
-- * Salaries keep their history: each row is an amount from a pay month
--   (from_month). A month pays the latest amount set from that month or before,
--   so a change can start this month or next month. Existing salaries start in
--   the month they were first set (the old rule), so nobody's pay changes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Salaries: amount from a pay month
-- -----------------------------------------------------------------------------
alter table public.member_salaries add column if not exists from_month date;

update public.member_salaries
   set from_month = public.pay_period_of((created_at at time zone 'Asia/Colombo')::date)
 where from_month is null;

alter table public.member_salaries alter column from_month set not null;
alter table public.member_salaries alter column from_month set default public.pay_period_of(public.colombo_today());

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'member_salaries_from_month_first_day') then
    alter table public.member_salaries
      add constraint member_salaries_from_month_first_day check (extract(day from from_month) = 1);
  end if;
  -- One amount per member, role and month (was one per member and role).
  if not exists (
    select 1
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
    where con.conrelid = 'public.member_salaries'::regclass and con.contype = 'p' and a.attname = 'from_month'
  ) then
    alter table public.member_salaries drop constraint if exists member_salaries_pkey;
    alter table public.member_salaries add constraint member_salaries_pkey primary key (user_id, role_id, from_month);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Pay start month (members paid from next month)
-- -----------------------------------------------------------------------------
create table if not exists public.member_pay_starts (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  from_month date not null check (extract(day from from_month) = 1),
  set_by     uuid references public.profiles (id) on delete set null,
  set_at     timestamptz not null default now()
);

alter table public.member_pay_starts enable row level security;
-- Changed only through public.set_member_pay_start.
revoke all on public.member_pay_starts from anon;
revoke insert, update, delete, truncate on public.member_pay_starts from authenticated;

drop policy if exists "pay starts: read own or admins" on public.member_pay_starts;
create policy "pay starts: read own or admins"
  on public.member_pay_starts for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- The open month for a member's work on this day: not before their pay start,
-- skipping months that are already closed.
create or replace function public.member_open_pay_period(p_user uuid, p_day date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m date := greatest(
    public.pay_period_of(p_day),
    coalesce((select from_month from public.member_pay_starts where user_id = p_user), '-infinity'::date)
  );
begin
  while exists (select 1 from public.pay_months where month = m) loop
    m := (m + interval '1 month')::date;
  end loop;
  return m;
end;
$$;

-- Same as migration 026, but work waits for the member's pay start month.
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
    new.work_month := public.member_open_pay_period(new.user_id, public.colombo_today());
  else
    new.work_month := old.work_month;
  end if;
  return new;
end;
$$;

-- Pay a member from next month (p_next) or from this month again.
-- Returns the start month, or null for "this month".
create or replace function public.set_member_pay_start(p_user uuid, p_next boolean)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date;
  moved integer := 0;
begin
  if not (public.is_main_admin() or public.has_page('members', true)) then
    raise exception 'Only people who can edit Members can change when a member is paid from.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Member not found.' using errcode = 'P0001';
  end if;

  if p_next then
    v_month := (public.pay_period_of(public.colombo_today()) + interval '1 month')::date;
    insert into public.member_pay_starts (user_id, from_month, set_by)
    values (p_user, v_month, (select auth.uid()))
    on conflict (user_id) do update
      set from_month = excluded.from_month, set_by = excluded.set_by, set_at = now();

    -- Their work so far moves to the start month (closed months stay as they are).
    perform set_config('app.moving_pay_period', 'on', true);
    update public.submissions s
       set work_month = v_month
     where s.user_id = p_user
       and s.work_month < v_month
       and not exists (select 1 from public.pay_months pm where pm.month = s.work_month);
    get diagnostics moved = row_count;
    perform set_config('app.moving_pay_period', 'off', true);

    perform public.write_activity('salary.pay_start', 'member', p_user::text, p_user,
      public.profile_name(p_user) || ' is paid from ' || public.month_name(v_month),
      jsonb_build_object('from_month', v_month, 'moved_work', moved));
  else
    delete from public.member_pay_starts where user_id = p_user;
    if found then
      perform public.write_activity('salary.pay_start', 'member', p_user::text, p_user,
        public.profile_name(p_user) || ' is paid from this month',
        jsonb_build_object('from_month', null));
    end if;
  end if;
  return v_month;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Activity and notifications say which month a salary starts
-- -----------------------------------------------------------------------------
create or replace function public.notify_member_salaries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
  prev numeric;
begin
  prev := case
    when tg_op = 'UPDATE' then old.monthly_amount
    else (select ms.monthly_amount from public.member_salaries ms
           where ms.user_id = new.user_id and ms.role_id = new.role_id and ms.from_month < new.from_month
           order by ms.from_month desc limit 1)
  end;
  if new.monthly_amount <= 0 or new.monthly_amount is not distinct from prev then
    return null;
  end if;
  select name into role_name from public.roles where id = new.role_id;
  perform public.notify(new.user_id, 'salary.changed',
    'Your ' || coalesce(role_name, '') || ' salary is ' || public.lkr(new.monthly_amount) || ' a month'
      || case when new.from_month > public.pay_period_of(public.colombo_today())
              then ' from ' || public.month_name(new.from_month) else '' end,
    case when prev > 0 then 'Was ' || public.lkr(prev) || '.' else null end,
    '/dashboard');
  return null;
end;
$$;

create or replace function public.audit_member_salaries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record := coalesce(new, old);
  role_name text;
  prev numeric;
begin
  -- Skip cascades when a member is deleted.
  if not exists (select 1 from public.profiles where id = rec.user_id) then
    return null;
  end if;
  select name into role_name from public.roles where id = rec.role_id;
  role_name := coalesce(role_name, 'a deleted role');

  if tg_op = 'DELETE' then
    perform public.write_activity('salary.removed', 'salary', old.user_id::text, old.user_id,
      'Removed the ' || role_name || ' salary of ' || public.profile_name(old.user_id)
        || ' (was ' || public.lkr(old.monthly_amount) || ')',
      jsonb_build_object('role_id', old.role_id, 'old_amount', old.monthly_amount, 'from_month', old.from_month));
    return null;
  end if;

  prev := case
    when tg_op = 'UPDATE' then old.monthly_amount
    else (select ms.monthly_amount from public.member_salaries ms
           where ms.user_id = new.user_id and ms.role_id = new.role_id and ms.from_month < new.from_month
           order by ms.from_month desc limit 1)
  end;
  if tg_op = 'UPDATE' and new.monthly_amount is not distinct from old.monthly_amount then
    return null;
  end if;

  if prev is null then
    perform public.write_activity('salary.set', 'salary', new.user_id::text, new.user_id,
      'Set the ' || role_name || ' salary of ' || public.profile_name(new.user_id) || ' to '
        || public.lkr(new.monthly_amount) || ' from ' || public.month_name(new.from_month),
      jsonb_build_object('role_id', new.role_id, 'new_amount', new.monthly_amount, 'from_month', new.from_month));
  else
    perform public.write_activity('salary.changed', 'salary', new.user_id::text, new.user_id,
      'Changed the ' || role_name || ' salary of ' || public.profile_name(new.user_id) || ': '
        || public.lkr(prev) || ' → ' || public.lkr(new.monthly_amount) || ' from ' || public.month_name(new.from_month),
      jsonb_build_object('role_id', new.role_id, 'old_amount', prev, 'new_amount', new.monthly_amount,
                         'from_month', new.from_month));
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Closing a month pays the salary in effect that month
-- -----------------------------------------------------------------------------
-- Same as migration 037 except salary_groups.
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
  -- Same rule as Analytics: the latest amount set from this month or before, for a
  -- salaried role the member still holds, active members, from their pay start month.
  salary_groups as (
    select ms.user_id, ms.role_id, r.name as role_name, ms.monthly_amount::numeric(14, 2) as amount
    from (
      select distinct on (s.user_id, s.role_id) s.user_id, s.role_id, s.monthly_amount
      from public.member_salaries s
      where s.from_month <= p_month
      order by s.user_id, s.role_id, s.from_month desc
    ) ms
    join public.roles r on r.id = ms.role_id and r.is_salaried
    join public.member_roles mr on mr.user_id = ms.user_id and mr.role_id = ms.role_id
    join public.profiles p on p.id = ms.user_id and p.is_active
    left join public.member_pay_starts ps on ps.user_id = ms.user_id
    where ms.monthly_amount > 0 and (ps.from_month is null or ps.from_month <= p_month)
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
-- 5. Permissions
-- -----------------------------------------------------------------------------
revoke execute on function public.member_open_pay_period(uuid, date) from public, anon, authenticated;
revoke execute on function public.set_member_pay_start(uuid, boolean) from public, anon;
grant execute on function public.set_member_pay_start(uuid, boolean) to authenticated;
revoke execute on function public.assign_pay_period() from public, anon, authenticated;
revoke execute on function public.notify_member_salaries() from public, anon, authenticated;
revoke execute on function public.audit_member_salaries() from public, anon, authenticated;
