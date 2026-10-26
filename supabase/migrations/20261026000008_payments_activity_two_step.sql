-- =============================================================================
-- 1. Two-step login: main-admin powers need a two-step (aal2) session.
-- 2. Activity log: written by triggers and functions, read by main admins,
--    never edited or deleted from the app.
-- 3. Close the month and mark as paid:
--      pay_months = closed months (a row means "closed")
--      payouts    = one row per member per closed month, with a snapshot of
--                   salary lines, work lines and bank details (for payslips)
--    Work in a closed month can't be added, changed or deleted.
-- (No DROP statements, so it runs without confirmation.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Two-step login for main admins
--   The JWT "aal" claim is "aal2" only after the authenticator-app code was
--   entered in this session. Without it a main admin is treated as an
--   ordinary admin by every policy that uses is_main_admin().
-- -----------------------------------------------------------------------------
create or replace function public.is_main_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
     and exists (
       select 1 from public.profiles
       where id = (select auth.uid()) and is_admin and is_main_admin and is_active
     );
$$;

-- -----------------------------------------------------------------------------
-- 2. Activity log
-- -----------------------------------------------------------------------------
create table if not exists public.activity_log (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  actor_id       uuid references public.profiles (id) on delete set null,
  actor_name     text not null,
  action         text not null check (char_length(action) between 3 and 60),
  entity_type    text not null check (char_length(entity_type) between 2 and 40),
  entity_id      text,
  target_user_id uuid references public.profiles (id) on delete set null,
  target_name    text,
  summary        text not null check (char_length(summary) between 1 and 500),
  details        jsonb not null default '{}'::jsonb
);

create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);
create index if not exists activity_log_actor_idx on public.activity_log (actor_id, created_at desc);
create index if not exists activity_log_target_idx on public.activity_log (target_user_id, created_at desc);
create index if not exists activity_log_action_idx on public.activity_log (action, created_at desc);

alter table public.activity_log enable row level security;
revoke all on public.activity_log from anon;
-- Rows are only added by the functions below.
revoke insert, update, delete, truncate on public.activity_log from authenticated;

create policy "activity_log: main admins read"
  on public.activity_log for select to authenticated
  using (public.is_main_admin());

-- Display name of a profile.
create or replace function public.profile_name(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(trim(full_name), ''), email) from public.profiles where id = p_id;
$$;

-- "October 2026"
create or replace function public.month_name(p_month date)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(to_char(p_month, 'FMMonth YYYY'));
$$;

-- "Rs. 1,500.00"
create or replace function public.lkr(p_amount numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'Rs. ' || trim(to_char(coalesce(p_amount, 0), 'FM999,999,999,990.00'));
$$;

-- Internal writer used by the triggers and functions in this file.
create or replace function public.write_activity(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_target uuid,
  p_summary text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target uuid := p_target;
begin
  -- The person may be in the middle of being deleted (cascades).
  if target is not null and not exists (select 1 from public.profiles where id = target) then
    target := null;
  end if;
  if actor is not null and not exists (select 1 from public.profiles where id = actor) then
    actor := null;
  end if;

  insert into public.activity_log
    (actor_id, actor_name, action, entity_type, entity_id, target_user_id, target_name, summary, details)
  values (
    actor,
    coalesce(public.profile_name(actor), 'System'),
    p_action,
    p_entity_type,
    p_entity_id,
    target,
    public.profile_name(target),
    left(p_summary, 500),
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

-- Events that happen outside the database (password resets, two-step changes,
-- payroll downloads) are logged by the app through this function. The actor is
-- always the signed-in user and only known event types are accepted.
create or replace function public.log_event(
  p_action text,
  p_target uuid default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target uuid := p_target;
  target_label text;
  summary text;
begin
  if actor is null or not exists (select 1 from public.profiles where id = actor and is_active) then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  target_label := coalesce(public.profile_name(target), 'a member');

  case p_action
    when 'member.created' then
      if not public.is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
      summary := 'Added ' || target_label || ' as a member';
    when 'member.password_reset' then
      if not public.is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
      summary := 'Reset the password of ' || target_label;
    when 'two_step.reset' then
      if not public.is_main_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
      summary := 'Turned off two-step login for ' || target_label;
    when 'payroll.exported' then
      if not public.is_main_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
      target := null;
      summary := 'Downloaded the payroll CSV (with bank details) for ' || coalesce(p_details ->> 'month_label', 'a month');
    when 'two_step.enabled' then
      target := actor;
      summary := 'Turned on two-step login';
    when 'two_step.disabled' then
      target := actor;
      summary := 'Turned off two-step login';
    else
      raise exception 'Unknown activity' using errcode = '22023';
  end case;

  perform public.write_activity(p_action, split_part(p_action, '.', 1), target::text, target, summary, p_details);
end;
$$;

-- ---- Audit triggers ---------------------------------------------------------

-- Reviews (approve / reject / back to pending) and admins deleting work.
create or replace function public.audit_submissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
  verb text;
begin
  if (select auth.uid()) is null then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then
      return null;
    end if;
    select name into role_name from public.roles where id = new.role_id;
    verb := case new.status when 'approved' then 'Approved' when 'rejected' then 'Rejected' else 'Moved back to pending' end;
    perform public.write_activity(
      'submission.' || case new.status when 'pending' then 'reopened' else new.status::text end,
      'submission',
      new.id::text,
      new.user_id,
      verb || ' "' || new.title || '" (' || coalesce(role_name, 'role') || ', ' || public.month_name(new.work_month) || ')'
        || case when new.status = 'approved' and new.amount is not null then ' · ' || public.lkr(new.amount) else '' end,
      jsonb_build_object('from', old.status, 'to', new.status, 'comment', new.admin_comment,
                         'amount', new.amount, 'quantity', new.quantity, 'month', new.work_month)
    );
    return null;
  end if;

  -- DELETE: only log when someone deletes another member's work.
  if old.user_id is distinct from (select auth.uid()) then
    perform public.write_activity(
      'submission.deleted', 'submission', old.id::text, old.user_id,
      'Deleted "' || old.title || '" (' || public.month_name(old.work_month) || ', ' || old.status || ')',
      jsonb_build_object('status', old.status, 'quantity', old.quantity, 'month', old.work_month)
    );
  end if;
  return null;
end;
$$;

create or replace trigger submissions_audit
  after update or delete on public.submissions
  for each row execute function public.audit_submissions();

-- Pay rates
create or replace function public.audit_rate_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record := coalesce(new, old);
  role_name text;
  label text;
begin
  select name into role_name from public.roles where id = rec.role_id;
  label := rec.name || ' (' || coalesce(role_name, 'deleted role') || ')';

  if tg_op = 'INSERT' then
    perform public.write_activity('rate.created', 'rate', new.id::text, null,
      'Added the rate ' || label || ': ' || public.lkr(new.price) || ' per ' || new.unit,
      jsonb_build_object('role_id', new.role_id, 'price', new.price, 'unit', new.unit));
  elsif tg_op = 'UPDATE' then
    if new.price is not distinct from old.price and new.name is not distinct from old.name
       and new.unit is not distinct from old.unit then
      return null;
    end if;
    perform public.write_activity('rate.changed', 'rate', new.id::text, null,
      'Changed the rate ' || label || ': '
        || case when new.price is distinct from old.price
             then public.lkr(old.price) || ' → ' || public.lkr(new.price)
             else 'renamed from ' || old.name || ' per ' || old.unit end,
      jsonb_build_object('role_id', new.role_id, 'old_price', old.price, 'new_price', new.price,
                         'old_name', old.name, 'new_name', new.name, 'old_unit', old.unit, 'new_unit', new.unit));
  else
    perform public.write_activity('rate.deleted', 'rate', old.id::text, null,
      'Removed the rate ' || label || ' (was ' || public.lkr(old.price) || ' per ' || old.unit || ')',
      jsonb_build_object('role_id', old.role_id, 'price', old.price, 'unit', old.unit));
  end if;
  return null;
end;
$$;

create or replace trigger rate_items_audit
  after insert or update or delete on public.rate_items
  for each row execute function public.audit_rate_items();

-- Fixed salary on / off for a role
create or replace function public.audit_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_salaried is distinct from old.is_salaried then
    perform public.write_activity('role.salary_type_changed', 'role', new.id::text, null,
      new.name || case when new.is_salaried then ' is now paid a fixed salary' else ' is now paid per unit of work' end,
      jsonb_build_object('is_salaried', new.is_salaried));
  end if;
  return null;
end;
$$;

create or replace trigger roles_audit
  after update on public.roles
  for each row execute function public.audit_roles();

-- Member salaries
create or replace function public.audit_member_salaries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record := coalesce(new, old);
  role_name text;
begin
  -- Skip cascades when a member is deleted.
  if not exists (select 1 from public.profiles where id = rec.user_id) then
    return null;
  end if;
  select name into role_name from public.roles where id = rec.role_id;
  role_name := coalesce(role_name, 'a deleted role');

  if tg_op = 'INSERT' then
    perform public.write_activity('salary.set', 'salary', new.user_id::text, new.user_id,
      'Set the ' || role_name || ' salary of ' || public.profile_name(new.user_id) || ' to ' || public.lkr(new.monthly_amount),
      jsonb_build_object('role_id', new.role_id, 'new_amount', new.monthly_amount));
  elsif tg_op = 'UPDATE' then
    if new.monthly_amount is not distinct from old.monthly_amount then
      return null;
    end if;
    perform public.write_activity('salary.changed', 'salary', new.user_id::text, new.user_id,
      'Changed the ' || role_name || ' salary of ' || public.profile_name(new.user_id) || ': '
        || public.lkr(old.monthly_amount) || ' → ' || public.lkr(new.monthly_amount),
      jsonb_build_object('role_id', new.role_id, 'old_amount', old.monthly_amount, 'new_amount', new.monthly_amount));
  else
    perform public.write_activity('salary.removed', 'salary', old.user_id::text, old.user_id,
      'Removed the ' || role_name || ' salary of ' || public.profile_name(old.user_id)
        || ' (was ' || public.lkr(old.monthly_amount) || ')',
      jsonb_build_object('role_id', old.role_id, 'old_amount', old.monthly_amount));
  end if;
  return null;
end;
$$;

create or replace trigger member_salaries_audit
  after insert or update or delete on public.member_salaries
  for each row execute function public.audit_member_salaries();

-- Role assignments
create or replace function public.audit_member_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record := coalesce(new, old);
  role_name text;
begin
  if not exists (select 1 from public.profiles where id = rec.user_id) then
    return null;
  end if;
  select name into role_name from public.roles where id = rec.role_id;
  if role_name is null then
    return null; -- the role itself is being deleted
  end if;
  perform public.write_activity(
    case when tg_op = 'INSERT' then 'role.assigned' else 'role.removed' end,
    'member', rec.user_id::text, rec.user_id,
    case when tg_op = 'INSERT'
      then 'Gave ' || public.profile_name(rec.user_id) || ' the role ' || role_name
      else 'Removed the role ' || role_name || ' from ' || public.profile_name(rec.user_id) end,
    jsonb_build_object('role_id', rec.role_id));
  return null;
end;
$$;

create or replace trigger member_roles_audit
  after insert or delete on public.member_roles
  for each row execute function public.audit_member_roles();

-- Active / admin / main admin changes
create or replace function public.audit_profiles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who text := coalesce(nullif(trim(new.full_name), ''), new.email);
begin
  if new.is_active is distinct from old.is_active then
    perform public.write_activity(
      case when new.is_active then 'member.activated' else 'member.deactivated' end,
      'member', new.id::text, new.id,
      case when new.is_active then 'Activated ' else 'Deactivated ' end || who, '{}'::jsonb);
  end if;
  if new.is_admin is distinct from old.is_admin then
    perform public.write_activity(
      case when new.is_admin then 'member.admin_granted' else 'member.admin_removed' end,
      'member', new.id::text, new.id,
      case when new.is_admin then 'Made ' || who || ' an admin' else 'Removed admin access from ' || who end,
      '{}'::jsonb);
  end if;
  if new.is_main_admin is distinct from old.is_main_admin then
    perform public.write_activity(
      case when new.is_main_admin then 'member.main_admin_granted' else 'member.main_admin_removed' end,
      'member', new.id::text, new.id,
      case when new.is_main_admin then 'Made ' || who || ' a main admin' else 'Removed main admin access from ' || who end,
      '{}'::jsonb);
  end if;
  return null;
end;
$$;

create or replace trigger profiles_audit
  after update on public.profiles
  for each row execute function public.audit_profiles();

-- Bank details (only the last 4 digits are written to the log)
create or replace function public.audit_bank_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record := coalesce(new, old);
  who text;
  by_owner boolean := (select auth.uid()) = rec.user_id;
begin
  if not exists (select 1 from public.profiles where id = rec.user_id) then
    return null;
  end if;
  who := public.profile_name(rec.user_id);

  if tg_op = 'INSERT' then
    perform public.write_activity('bank.added', 'bank', new.user_id::text, new.user_id,
      case when by_owner then 'Added their bank details' else 'Added bank details for ' || who end
        || ' (' || new.bank_name || ', ****' || new.account_last4 || ')',
      jsonb_build_object('bank', new.bank_name, 'last4', new.account_last4));
  elsif tg_op = 'UPDATE' then
    if new.account_number is not distinct from old.account_number and new.bank_name is not distinct from old.bank_name
       and new.branch is not distinct from old.branch and new.account_holder is not distinct from old.account_holder then
      return null;
    end if;
    perform public.write_activity('bank.changed', 'bank', new.user_id::text, new.user_id,
      case when by_owner then 'Changed their bank details' else 'Changed the bank details of ' || who end
        || case when new.account_number is distinct from old.account_number
             then ': ****' || old.account_last4 || ' → ****' || new.account_last4 else '' end,
      jsonb_build_object('old_bank', old.bank_name, 'new_bank', new.bank_name,
                         'old_last4', old.account_last4, 'new_last4', new.account_last4));
  else
    perform public.write_activity('bank.removed', 'bank', old.user_id::text, old.user_id,
      case when by_owner then 'Removed their bank details' else 'Removed the bank details of ' || who end,
      jsonb_build_object('bank', old.bank_name, 'last4', old.account_last4));
  end if;
  return null;
end;
$$;

create or replace trigger bank_details_audit
  after insert or update or delete on public.bank_details
  for each row execute function public.audit_bank_details();

-- Monthly budget
create or replace function public.audit_app_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.monthly_budget is distinct from old.monthly_budget then
    perform public.write_activity('budget.changed', 'settings', null, null,
      'Changed the monthly budget: ' || public.lkr(old.monthly_budget) || ' → ' || public.lkr(new.monthly_budget),
      jsonb_build_object('old_amount', old.monthly_budget, 'new_amount', new.monthly_budget));
  end if;
  return null;
end;
$$;

create or replace trigger app_settings_audit
  after update on public.app_settings
  for each row execute function public.audit_app_settings();

-- -----------------------------------------------------------------------------
-- 3. Closed months and payouts
-- -----------------------------------------------------------------------------
create table if not exists public.pay_months (
  month     date primary key check (extract(day from month) = 1),
  closed_at timestamptz not null default now(),
  closed_by uuid references public.profiles (id) on delete set null,
  note      text check (char_length(note) <= 500)
);

create index if not exists pay_months_closed_by_idx on public.pay_months (closed_by);

alter table public.pay_months enable row level security;
revoke all on public.pay_months from anon;
-- Written only by close_pay_month / reopen_pay_month.
revoke insert, update, delete, truncate on public.pay_months from authenticated;

-- Everyone signed in may see which months are closed (the work form needs it).
create policy "pay_months: signed-in users read"
  on public.pay_months for select to authenticated
  using (true);

create table if not exists public.payouts (
  id                uuid primary key default gen_random_uuid(),
  month             date not null references public.pay_months (month) on delete cascade,
  payslip_no        text not null unique,
  user_id           uuid references public.profiles (id) on delete set null,
  -- Snapshot taken when the month is closed, so payslips never change afterwards.
  member_name       text not null,
  member_email      text not null,
  member_phone      text,
  member_nic        text,
  bank_name         text,
  bank_branch       text,
  account_holder    text,
  account_last4     text,
  salary_amount     numeric(14, 2) not null default 0,
  work_amount       numeric(14, 2) not null default 0,
  total_amount      numeric(14, 2) generated always as (salary_amount + work_amount) stored,
  approved_items    integer not null default 0,
  approved_units    integer not null default 0,
  salary_lines      jsonb not null default '[]'::jsonb,
  work_lines        jsonb not null default '[]'::jsonb,
  status            text not null default 'unpaid' check (status in ('unpaid', 'paid')),
  paid_on           date,
  paid_at           timestamptz,
  paid_by           uuid references public.profiles (id) on delete set null,
  payment_reference text check (char_length(payment_reference) <= 100),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (month, user_id),
  check ((status = 'paid') = (paid_on is not null))
);

create index if not exists payouts_user_idx on public.payouts (user_id, month desc);
create index if not exists payouts_paid_by_idx on public.payouts (paid_by);

create or replace trigger payouts_set_updated_at
  before update on public.payouts
  for each row execute function public.set_updated_at();

alter table public.payouts enable row level security;
revoke all on public.payouts from anon;
-- Written only by the functions below.
revoke insert, update, delete, truncate on public.payouts from authenticated;

create policy "payouts: read own"
  on public.payouts for select to authenticated
  using (user_id = (select auth.uid()));

create policy "payouts: main admins read"
  on public.payouts for select to authenticated
  using (public.is_main_admin());

-- Work in a closed month can't be added, changed or deleted.
-- (Service-role / SQL editor changes and member deletions are allowed.)
create or replace function public.guard_closed_month()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed date;
begin
  if (select auth.uid()) is null then
    return coalesce(new, old);
  end if;

  select month into closed from public.pay_months
  where month in (
    case when tg_op <> 'INSERT' then old.work_month end,
    case when tg_op <> 'DELETE' then new.work_month end
  )
  limit 1;

  if closed is not null then
    raise exception '% is closed for payments, so its work can''t be changed.', public.month_name(closed)
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- Fires first (triggers run in name order).
create or replace trigger submissions_a_closed_month
  before insert or update or delete on public.submissions
  for each row execute function public.guard_closed_month();

-- Close a month: every submission must be reviewed first. Snapshots what each
-- member is owed (fixed salaries + approved work) into payouts.
create or replace function public.close_pay_month(p_month date, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_count integer;
  created integer;
  total numeric(14, 2);
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can close a month.' using errcode = '42501';
  end if;
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'Choose a month.' using errcode = 'P0001';
  end if;
  if p_month > date_trunc('month', current_date)::date then
    raise exception 'You can''t close a month that hasn''t started yet.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.pay_months where month = p_month) then
    raise exception '% is already closed.', public.month_name(p_month) using errcode = 'P0001';
  end if;

  select count(*) into pending_count
  from public.submissions where work_month = p_month and status = 'pending';
  if pending_count > 0 then
    raise exception 'Review the % pending submission% for % first.',
      pending_count, case when pending_count = 1 then '' else 's' end, public.month_name(p_month)
      using errcode = 'P0001';
  end if;

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
    jsonb_build_object('month', p_month, 'members', created, 'total', total, 'note', nullif(trim(p_note), '')));
  return created;
end;
$$;

-- Reopen a closed month (only while nobody in it is marked as paid).
create or replace function public.reopen_pay_month(p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can reopen a month.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pay_months where month = p_month) then
    raise exception '% is not closed.', public.month_name(p_month) using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payouts where month = p_month and status = 'paid') then
    raise exception 'Some members in % are already marked as paid. Mark them as not paid first.',
      public.month_name(p_month) using errcode = 'P0001';
  end if;

  delete from public.pay_months where month = p_month; -- payouts are removed with it

  perform public.write_activity('month.reopened', 'month', p_month::text, null,
    'Reopened ' || public.month_name(p_month) || ' (payslips removed, work can be changed again)',
    jsonb_build_object('month', p_month));
end;
$$;

-- Mark payouts as paid (with the date and an optional bank reference) or not paid.
create or replace function public.set_payouts_paid(
  p_ids uuid[],
  p_paid boolean,
  p_paid_on date default null,
  p_reference text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  changed integer := 0;
  ref text := nullif(trim(p_reference), '');
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can record payments.' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 then
    raise exception 'Choose who to update.' using errcode = 'P0001';
  end if;
  if p_paid and (p_paid_on is null or p_paid_on > current_date + 1 or p_paid_on < date '2020-01-01') then
    raise exception 'Choose the date it was paid (not in the future).' using errcode = 'P0001';
  end if;
  if char_length(ref) > 100 then
    raise exception 'The reference must be at most 100 characters.' using errcode = 'P0001';
  end if;

  if p_paid then
    for rec in
      with updated as (
        update public.payouts
        set status = 'paid', paid_on = p_paid_on, paid_at = now(), paid_by = (select auth.uid()), payment_reference = ref
        where id = any (p_ids) and status = 'unpaid'
        returning id, user_id, member_name, month, total_amount
      )
      select * from updated
    loop
      changed := changed + 1;
      perform public.write_activity('payout.paid', 'payout', rec.id::text, rec.user_id,
        'Marked ' || rec.member_name || ' as paid ' || public.lkr(rec.total_amount) || ' for ' || public.month_name(rec.month)
          || coalesce(' (ref ' || ref || ')', ''),
        jsonb_build_object('month', rec.month, 'amount', rec.total_amount, 'paid_on', p_paid_on, 'reference', ref));
    end loop;
  else
    for rec in
      with updated as (
        update public.payouts
        set status = 'unpaid', paid_on = null, paid_at = null, paid_by = null, payment_reference = null
        where id = any (p_ids) and status = 'paid'
        returning id, user_id, member_name, month, total_amount
      )
      select * from updated
    loop
      changed := changed + 1;
      perform public.write_activity('payout.unpaid', 'payout', rec.id::text, rec.user_id,
        'Marked ' || rec.member_name || ' as not paid for ' || public.month_name(rec.month),
        jsonb_build_object('month', rec.month, 'amount', rec.total_amount));
    end loop;
  end if;
  return changed;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function permissions
-- -----------------------------------------------------------------------------
-- Internal helpers and trigger functions: not callable through the API.
revoke execute on function public.profile_name(uuid) from public, anon, authenticated;
revoke execute on function public.write_activity(text, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.audit_submissions() from public, anon, authenticated;
revoke execute on function public.audit_rate_items() from public, anon, authenticated;
revoke execute on function public.audit_roles() from public, anon, authenticated;
revoke execute on function public.audit_member_salaries() from public, anon, authenticated;
revoke execute on function public.audit_member_roles() from public, anon, authenticated;
revoke execute on function public.audit_profiles() from public, anon, authenticated;
revoke execute on function public.audit_bank_details() from public, anon, authenticated;
revoke execute on function public.audit_app_settings() from public, anon, authenticated;
revoke execute on function public.guard_closed_month() from public, anon, authenticated;

-- Called by the app (each one checks who is calling).
revoke execute on function public.log_event(text, uuid, jsonb) from public, anon;
revoke execute on function public.close_pay_month(date, text) from public, anon;
revoke execute on function public.reopen_pay_month(date) from public, anon;
revoke execute on function public.set_payouts_paid(uuid[], boolean, date, text) from public, anon;
grant execute on function public.log_event(text, uuid, jsonb) to authenticated;
grant execute on function public.close_pay_month(date, text) to authenticated;
grant execute on function public.reopen_pay_month(date) to authenticated;
grant execute on function public.set_payouts_paid(uuid[], boolean, date, text) to authenticated;
