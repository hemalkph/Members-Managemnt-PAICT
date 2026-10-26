-- =============================================================================
-- 1. Notifications: an in-app inbox per person. Rows are created by database
--    triggers and functions only; people can read them, mark them as read and
--    delete their own.
-- 2. Monthly work deadline: "submit October work by 3 November". After the
--    deadline members can't add or change that month's work (admins still
--    can). Main admins can give a single month more time. Reminders are sent
--    in the days before the deadline (daily job + on dashboard visits).
-- (No DROP statements, so it runs without confirmation.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Notifications
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (char_length(kind) between 3 and 40),
  title      text not null check (char_length(title) between 1 and 200),
  body       text check (char_length(body) <= 500),
  -- Only links inside the app.
  link       text check (link ~ '^/[^/]' or link = '/'),
  -- Stops the same reminder being sent twice.
  dedupe_key text check (char_length(dedupe_key) <= 100),
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  unique (user_id, dedupe_key)
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
-- People may only mark their own as read (read_at) or delete them.
revoke insert, update, truncate on public.notifications from authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy "notifications: read own"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

create policy "notifications: mark own as read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "notifications: delete own"
  on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- Live updates for the bell (Supabase Realtime respects the policies above).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- Internal: send one notification (active people only; duplicates by dedupe_key are skipped).
create or replace function public.notify(
  p_user uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_dedupe text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user and is_active) then
    return;
  end if;
  insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
  values (p_user, p_kind, left(p_title, 200), left(p_body, 500), p_link, p_dedupe)
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

-- "2026-10" for links
create or replace function public.month_key(p_month date)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_month, 'YYYY-MM');
$$;

-- Work reviewed → tell the member. New work → one grouped message per admin.
create or replace function public.notify_submissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  pending_count integer;
  member_name text;
  admin_row record;
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status or actor is not distinct from new.user_id then
      return null;
    end if;
    perform public.notify(
      new.user_id,
      'submission.' || case new.status when 'pending' then 'reopened' else new.status::text end,
      case new.status
        when 'approved' then 'Your work was approved'
        when 'rejected' then 'Your work was not approved'
        else 'Your work is back in review'
      end,
      '"' || new.title || '"'
        || case when new.status = 'approved' and new.amount is not null and new.amount > 0
             then ' · ' || public.lkr(new.amount) else '' end
        || case when new.status = 'rejected' and new.admin_comment is not null
             then ' · ' || new.admin_comment else '' end,
      '/work?month=' || public.month_key(new.work_month)
    );
    return null;
  end if;

  -- INSERT
  select count(*) into pending_count from public.submissions where status = 'pending';
  member_name := coalesce(public.profile_name(new.user_id), 'A member');
  for admin_row in
    select id from public.profiles where is_admin and is_active and id is distinct from new.user_id
  loop
    update public.notifications
    set title = pending_count || ' submission' || case when pending_count = 1 then '' else 's' end || ' waiting for review',
        body = 'Latest: ' || member_name || ' – "' || new.title || '"',
        created_at = now()
    where user_id = admin_row.id and kind = 'review.pending' and read_at is null;
    if not found then
      perform public.notify(
        admin_row.id, 'review.pending',
        pending_count || ' submission' || case when pending_count = 1 then '' else 's' end || ' waiting for review',
        'Latest: ' || member_name || ' – "' || new.title || '"',
        '/admin/review?status=pending'
      );
    end if;
  end loop;
  return null;
end;
$$;

create or replace trigger submissions_notify
  after insert or update on public.submissions
  for each row execute function public.notify_submissions();

-- Payslip ready (month closed) and paid.
create or replace function public.notify_payouts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.total_amount > 0 then
      perform public.notify(
        new.user_id, 'payout.ready',
        'Your payslip for ' || public.month_name(new.month) || ' is ready',
        public.lkr(new.total_amount) || ' · payment is on its way',
        '/payslips/' || new.id::text,
        'payout-ready:' || new.id::text
      );
    end if;
  elsif new.status = 'paid' and old.status is distinct from 'paid' and new.total_amount > 0 then
    perform public.notify(
      new.user_id, 'payout.paid',
      'You have been paid ' || public.lkr(new.total_amount),
      'For ' || public.month_name(new.month)
        || coalesce(' · ref ' || new.payment_reference, '') || ' · check your bank account',
      '/payslips/' || new.id::text
    );
  end if;
  return null;
end;
$$;

create or replace trigger payouts_notify
  after insert or update on public.payouts
  for each row execute function public.notify_payouts();

-- New notice on the notice board.
create or replace function public.notify_announcements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  person record;
begin
  if new.expires_on is not null and new.expires_on < current_date then
    return null;
  end if;
  for person in
    select id from public.profiles where is_active and id is distinct from new.created_by
  loop
    perform public.notify(person.id, 'notice.new', 'New notice: ' || new.title, left(new.body, 160), '/dashboard');
  end loop;
  return null;
end;
$$;

create or replace trigger announcements_notify
  after insert on public.announcements
  for each row execute function public.notify_announcements();

-- New role.
create or replace function public.notify_member_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
begin
  if new.user_id is not distinct from (select auth.uid()) then
    return null;
  end if;
  select name into role_name from public.roles where id = new.role_id;
  if role_name is not null then
    perform public.notify(new.user_id, 'role.assigned', 'You have a new role: ' || role_name,
      'You can now log work as ' || role_name || '.', '/work/new');
  end if;
  return null;
end;
$$;

create or replace trigger member_roles_notify
  after insert on public.member_roles
  for each row execute function public.notify_member_roles();

-- Salary set or changed.
create or replace function public.notify_member_salaries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
begin
  if new.monthly_amount <= 0
     or (tg_op = 'UPDATE' and new.monthly_amount is not distinct from old.monthly_amount) then
    return null;
  end if;
  select name into role_name from public.roles where id = new.role_id;
  perform public.notify(new.user_id, 'salary.changed',
    'Your ' || coalesce(role_name, '') || ' salary is ' || public.lkr(new.monthly_amount) || ' a month',
    case when tg_op = 'UPDATE' then 'Was ' || public.lkr(old.monthly_amount) || '.' else null end,
    '/dashboard');
  return null;
end;
$$;

create or replace trigger member_salaries_notify
  after insert or update on public.member_salaries
  for each row execute function public.notify_member_salaries();

-- -----------------------------------------------------------------------------
-- 2. Monthly work deadline
-- -----------------------------------------------------------------------------
alter table public.app_settings add column if not exists deadline_enabled boolean not null default true;
alter table public.app_settings add column if not exists deadline_day smallint not null default 3;
alter table public.app_settings add column if not exists reminder_days smallint not null default 3;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_deadline_day_check') then
    alter table public.app_settings
      add constraint app_settings_deadline_day_check check (deadline_day between 1 and 28);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_settings_reminder_days_check') then
    alter table public.app_settings
      add constraint app_settings_reminder_days_check check (reminder_days between 0 and 10);
  end if;
end;
$$;

-- A month with more time than the normal rule.
create table if not exists public.month_deadlines (
  month      date primary key check (extract(day from month) = 1),
  -- First moment work is NOT accepted any more (start of the day after the last day).
  deadline   timestamptz not null,
  set_by     uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists month_deadlines_set_by_idx on public.month_deadlines (set_by);

alter table public.month_deadlines enable row level security;
revoke all on public.month_deadlines from anon;
revoke insert, update, delete, truncate on public.month_deadlines from authenticated;

create policy "month_deadlines: signed-in users read"
  on public.month_deadlines for select to authenticated
  using (true);

-- When work for a month stops being accepted from members (null = no deadline).
-- Normal rule: the end of day N of the next month, Sri Lanka time.
create or replace function public.work_deadline(p_month date)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select deadline from public.month_deadlines where month = p_month),
    (select case when s.deadline_enabled
       then (((p_month + interval '1 month')::date + s.deadline_day)::timestamp at time zone 'Asia/Colombo')
     end
     from public.app_settings s limit 1)
  );
$$;

-- Several months at once (for the work form and dashboards).
create or replace function public.work_deadlines(p_months date[])
returns table (month date, deadline timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m, public.work_deadline(m) from unnest(p_months) as m;
$$;

-- "3 Nov 2026" = the last day work is accepted.
create or replace function public.deadline_label(p_deadline timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(to_char((p_deadline - interval '1 second') at time zone 'Asia/Colombo', 'FMDD Mon YYYY'));
$$;

-- Members can't add or change work after the month's deadline. Admins can.
create or replace function public.guard_work_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  due timestamptz;
begin
  if (select auth.uid()) is null or public.is_admin() then
    return new;
  end if;
  due := public.work_deadline(new.work_month);
  if due is not null and now() >= due then
    raise exception 'The deadline for % work was %. Ask an admin if something is missing.',
      public.month_name(new.work_month), public.deadline_label(due)
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Runs after the closed-month check and before the review guard (name order).
create or replace trigger submissions_b_deadline
  before insert or update on public.submissions
  for each row execute function public.guard_work_deadline();

-- Main admins: give one month more time (p_last_day = last day work is accepted),
-- or pass null to go back to the normal rule.
create or replace function public.set_month_deadline(p_month date, p_last_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  due timestamptz;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can change deadlines.' using errcode = '42501';
  end if;
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'Choose a month.' using errcode = 'P0001';
  end if;

  if p_last_day is null then
    delete from public.month_deadlines where month = p_month;
    perform public.write_activity('deadline.reset', 'month', p_month::text, null,
      'Set the ' || public.month_name(p_month) || ' deadline back to the normal rule', jsonb_build_object('month', p_month));
    return;
  end if;

  if p_last_day < p_month or p_last_day > (p_month + interval '6 months')::date then
    raise exception 'Choose a last day between the start of the month and 6 months later.' using errcode = 'P0001';
  end if;
  due := ((p_last_day + 1)::timestamp at time zone 'Asia/Colombo');

  insert into public.month_deadlines (month, deadline, set_by)
  values (p_month, due, (select auth.uid()))
  on conflict (month) do update set deadline = excluded.deadline, set_by = excluded.set_by, created_at = now();

  perform public.write_activity('deadline.extended', 'month', p_month::text, null,
    'Set the ' || public.month_name(p_month) || ' work deadline to ' || public.deadline_label(due),
    jsonb_build_object('month', p_month, 'last_day', p_last_day));
end;
$$;

-- Reminders before the deadline (members with roles) and a note to admins
-- once it has passed. Safe to run any number of times: each message is sent once.
create or replace function public.send_deadline_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings record;
  this_month date := date_trunc('month', now() at time zone 'Asia/Colombo')::date;
  m date;
  due timestamptz;
  days_left integer;
  sent integer := 0;
  pending_count integer;
  person record;
begin
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
          'Submit your ' || public.month_name(m) || ' work by ' || public.deadline_label(due),
          case when days_left <= 1 then 'Last day today! '
               else days_left || ' days left. ' end
            || 'Work can''t be added after the deadline.',
          '/work/new?month=' || public.month_key(m),
          'deadline:' || public.month_key(m) || ':' || days_left
        );
        sent := sent + 1;
      end loop;
    elsif now() < due + interval '10 days' then
      select count(*) into pending_count from public.submissions where work_month = m and status = 'pending';
      for person in select id from public.profiles where is_admin and is_active loop
        perform public.notify(
          person.id, 'deadline.passed',
          'The ' || public.month_name(m) || ' deadline has passed',
          case when pending_count > 0
            then pending_count || ' submission' || case when pending_count = 1 then '' else 's' end
                 || ' to review, then close the month in Payments.'
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

-- Activity log: deadline rule changes too.
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
  if new.deadline_enabled is distinct from old.deadline_enabled
     or new.deadline_day is distinct from old.deadline_day
     or new.reminder_days is distinct from old.reminder_days then
    perform public.write_activity('deadline.rule_changed', 'settings', null, null,
      case when new.deadline_enabled
        then 'Set the work deadline to day ' || new.deadline_day || ' of the next month (reminders '
             || new.reminder_days || ' day' || case when new.reminder_days = 1 then '' else 's' end || ' before)'
        else 'Turned off the monthly work deadline' end,
      jsonb_build_object('enabled', new.deadline_enabled, 'day', new.deadline_day, 'reminder_days', new.reminder_days));
  end if;
  return null;
end;
$$;

-- Daily reminders at 9:00 Sri Lanka time (03:30 UTC) when pg_cron is available.
-- The app also runs send_deadline_reminders() when dashboards are opened.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('team-deadline-reminders', '30 3 * * *', 'select public.send_deadline_reminders()');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function permissions
-- -----------------------------------------------------------------------------
revoke execute on function public.notify(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.notify_submissions() from public, anon, authenticated;
revoke execute on function public.notify_payouts() from public, anon, authenticated;
revoke execute on function public.notify_announcements() from public, anon, authenticated;
revoke execute on function public.notify_member_roles() from public, anon, authenticated;
revoke execute on function public.notify_member_salaries() from public, anon, authenticated;
revoke execute on function public.guard_work_deadline() from public, anon, authenticated;

revoke execute on function public.work_deadline(date) from public, anon;
revoke execute on function public.work_deadlines(date[]) from public, anon;
revoke execute on function public.set_month_deadline(date, date) from public, anon;
revoke execute on function public.send_deadline_reminders() from public, anon;
grant execute on function public.work_deadline(date) to authenticated;
grant execute on function public.work_deadlines(date[]) to authenticated;
grant execute on function public.set_month_deadline(date, date) to authenticated;
grant execute on function public.send_deadline_reminders() to authenticated;
