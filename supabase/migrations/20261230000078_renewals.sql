-- =============================================================================
-- Renewals: outcomes for unpaid students, a call owner per class, one renewal
-- snapshot per class per day, and the 9:00 call / can't-afford notices.
-- Safe to run more than once.
--
--   fee_classes.followup_owner_id   Who phones this class's unpaid students.
--   fee_due_followups               New outcomes (promised, cant_afford, moved_class),
--                                   promised date, drop reason, calls, and paid_seen_at
--                                   (set when an upload shows the student has paid).
--   fee_renewal_snapshots           Renewed / new counts per class per day (the chart).
--   app_settings                    renewal_due_day (10) and renewal_target_pct (90).
--
-- Students are matched in the app (lib/fees/compare.ts), the same way the Fee
-- reminders page does; it tells fee_renewal_record which follow-ups are still due.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columns and tables
-- -----------------------------------------------------------------------------
alter table public.fee_classes
  add column if not exists followup_owner_id uuid references public.profiles (id) on delete set null;

alter table public.fee_due_followups drop constraint if exists fee_due_followups_status_check;
alter table public.fee_due_followups add constraint fee_due_followups_status_check
  check (status in ('pending', 'messaged', 'promised', 'excused', 'dropped', 'cant_afford', 'moved_class'));

alter table public.fee_due_followups
  add column if not exists promised_by    date,
  add column if not exists reason         text not null default '' check (char_length(reason) <= 40),
  add column if not exists moved_to_class uuid references public.fee_classes (id) on delete set null,
  add column if not exists call_count     integer not null default 0 check (call_count >= 0),
  add column if not exists last_called_at timestamptz,
  add column if not exists last_called_by uuid references public.profiles (id) on delete set null,
  add column if not exists paid_seen_at   timestamptz;

alter table public.app_settings
  add column if not exists renewal_due_day    smallint not null default 10 check (renewal_due_day between 1 and 28),
  add column if not exists renewal_target_pct smallint not null default 90 check (renewal_target_pct between 1 and 100);

create table if not exists public.fee_renewal_snapshots (
  class_id     uuid not null references public.fee_classes (id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  day          date not null,
  prev_total   integer not null check (prev_total >= 0),
  renewed      integer not null check (renewed >= 0),
  new_students integer not null check (new_students >= 0),
  taken_at     timestamptz not null default now(),
  primary key (class_id, month, day)
);

alter table public.fee_renewal_snapshots enable row level security;
revoke all on table public.fee_renewal_snapshots from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. The old follow-up save accepts every status (so the Fee reminders dialog
--    can save a row that has a new outcome without changing it).
-- -----------------------------------------------------------------------------
create or replace function public.fee_followup_set(
  p_class_id uuid,
  p_due_month date,
  p_student_key text,
  p_student_name text,
  p_email_norm text,
  p_whatsapp_norm text,
  p_status text,
  p_label text default null,
  p_note text default null,
  p_template_id uuid default null,
  p_increment_message boolean default false
)
returns public.fee_due_followups
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  m date := date_trunc('month', p_due_month)::date;
  key text := left(trim(coalesce(p_student_key, '')), 200);
  v_wa text := nullif(trim(coalesce(p_whatsapp_norm, '')), '');
  out_row public.fee_due_followups;
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to update fee follow-ups.' using errcode = '42501';
  end if;
  if char_length(key) < 2 then
    raise exception 'Invalid student key.' using errcode = 'P0001';
  end if;
  if p_status is null or p_status not in ('pending', 'messaged', 'promised', 'excused', 'dropped', 'cant_afford', 'moved_class') then
    raise exception 'Unknown follow-up status.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.fee_classes where id = p_class_id) then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;

  insert into public.fee_due_followups (
    class_id, due_month, student_key, student_name, email_norm, whatsapp_norm,
    status, label, message_count, last_messaged_at, last_messaged_by, last_template_id,
    note, updated_by, updated_at
  )
  values (
    p_class_id,
    m,
    key,
    left(trim(coalesce(p_student_name, '')), 150),
    left(lower(trim(coalesce(p_email_norm, ''))), 200),
    v_wa,
    p_status,
    left(trim(coalesce(p_label, '')), 80),
    case when coalesce(p_increment_message, false) then 1 else 0 end,
    case when coalesce(p_increment_message, false) then now() else null end,
    case when coalesce(p_increment_message, false) then actor else null end,
    case when coalesce(p_increment_message, false) then p_template_id else null end,
    left(trim(coalesce(p_note, '')), 500),
    actor,
    now()
  )
  on conflict (class_id, due_month, student_key) do update set
    student_name     = case when excluded.student_name <> '' then excluded.student_name else fee_due_followups.student_name end,
    email_norm       = case when excluded.email_norm <> '' then excluded.email_norm else fee_due_followups.email_norm end,
    whatsapp_norm    = coalesce(excluded.whatsapp_norm, fee_due_followups.whatsapp_norm),
    status           = excluded.status,
    label            = case when p_label is not null then left(trim(p_label), 80) else fee_due_followups.label end,
    note             = case when p_note is not null then left(trim(p_note), 500) else fee_due_followups.note end,
    message_count    = fee_due_followups.message_count + case when coalesce(p_increment_message, false) then 1 else 0 end,
    last_messaged_at = case when coalesce(p_increment_message, false) then now() else fee_due_followups.last_messaged_at end,
    last_messaged_by = case when coalesce(p_increment_message, false) then actor else fee_due_followups.last_messaged_by end,
    last_template_id = case when coalesce(p_increment_message, false) then coalesce(p_template_id, fee_due_followups.last_template_id) else fee_due_followups.last_template_id end,
    updated_by       = actor,
    updated_at       = now()
  returning * into out_row;

  return out_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Call owner, outcomes, snapshots, settings
-- -----------------------------------------------------------------------------
create or replace function public.fee_class_owner_set(p_class uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cls_name text;
begin
  if not (public.has_page('fee_reminders', true) or public.has_page('class_ops', true)) then
    raise exception 'You are not allowed to set who calls this class.' using errcode = '42501';
  end if;
  select c.name into cls_name from public.fee_classes c where c.id = p_class;
  if cls_name is null then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;
  if p_owner is not null and p_owner not in (select public.people_with_page('fee_reminders')) then
    raise exception 'Pick someone who can open Fee reminders.' using errcode = 'P0001';
  end if;

  update public.fee_classes set followup_owner_id = p_owner where id = p_class;

  perform public.write_activity('fee.call_owner_set', 'fee_class', p_class::text, p_owner,
    case when p_owner is null then 'Cleared who calls unpaid students in ' || cls_name
         else coalesce(public.profile_name(p_owner), 'Someone') || ' now calls unpaid students in ' || cls_name end,
    jsonb_build_object('class_id', p_class, 'owner_id', p_owner));
end;
$$;

create or replace function public.fee_followup_outcome(
  p_class_id uuid,
  p_due_month date,
  p_student_key text,
  p_student_name text,
  p_whatsapp_norm text,
  p_outcome text,
  p_promised_by date default null,
  p_reason text default null,
  p_moved_to uuid default null,
  p_note text default null,
  p_called boolean default true
)
returns public.fee_due_followups
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  m date := date_trunc('month', p_due_month)::date;
  today date := (now() at time zone 'Asia/Colombo')::date;
  key text := left(trim(coalesce(p_student_key, '')), 200);
  v_wa text := nullif(trim(coalesce(p_whatsapp_norm, '')), '');
  called boolean := coalesce(p_called, true);
  new_status text;
  out_row public.fee_due_followups;
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to update fee follow-ups.' using errcode = '42501';
  end if;
  if char_length(key) < 2 or m is null then
    raise exception 'Invalid student.' using errcode = 'P0001';
  end if;
  if p_outcome is null or p_outcome not in ('no_answer', 'promised', 'cant_afford', 'moved_class', 'dropped', 'excused') then
    raise exception 'Unknown outcome.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.fee_classes where id = p_class_id) then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;
  if p_outcome = 'promised' and (p_promised_by is null or p_promised_by < today or p_promised_by > today + 45) then
    raise exception 'Pick the date they promised to pay.' using errcode = 'P0001';
  end if;
  if p_outcome = 'dropped'
     and coalesce(p_reason, '') not in ('exams', 'money', 'moved_away', 'timing', 'other_institute', 'other') then
    raise exception 'Pick why they left.' using errcode = 'P0001';
  end if;
  if p_outcome = 'moved_class'
     and (p_moved_to is null or p_moved_to = p_class_id or not exists (select 1 from public.fee_classes where id = p_moved_to)) then
    raise exception 'Pick the class they moved to.' using errcode = 'P0001';
  end if;

  new_status := case when p_outcome = 'no_answer' then null else p_outcome end;

  insert into public.fee_due_followups (
    class_id, due_month, student_key, student_name, whatsapp_norm, status,
    promised_by, reason, moved_to_class, call_count, last_called_at, last_called_by,
    note, updated_by, updated_at
  )
  values (
    p_class_id, m, key, left(trim(coalesce(p_student_name, '')), 150), v_wa, coalesce(new_status, 'pending'),
    case when p_outcome = 'promised' then p_promised_by end,
    case when p_outcome = 'dropped' then p_reason else '' end,
    case when p_outcome = 'moved_class' then p_moved_to end,
    case when called then 1 else 0 end,
    case when called then now() end,
    case when called then actor end,
    left(trim(coalesce(p_note, '')), 500), actor, now()
  )
  on conflict (class_id, due_month, student_key) do update set
    student_name   = case when excluded.student_name <> '' then excluded.student_name else fee_due_followups.student_name end,
    whatsapp_norm  = coalesce(excluded.whatsapp_norm, fee_due_followups.whatsapp_norm),
    status         = coalesce(new_status, fee_due_followups.status),
    promised_by    = case when p_outcome = 'promised' then p_promised_by else fee_due_followups.promised_by end,
    reason         = case when p_outcome = 'dropped' then p_reason else fee_due_followups.reason end,
    moved_to_class = case when p_outcome = 'moved_class' then p_moved_to else fee_due_followups.moved_to_class end,
    call_count     = fee_due_followups.call_count + case when called then 1 else 0 end,
    last_called_at = case when called then now() else fee_due_followups.last_called_at end,
    last_called_by = case when called then actor else fee_due_followups.last_called_by end,
    note           = case when p_note is not null then left(trim(p_note), 500) else fee_due_followups.note end,
    updated_by     = actor,
    updated_at     = now()
  returning * into out_row;

  return out_row;
end;
$$;

create or replace function public.fee_renewal_record(
  p_class uuid, p_month date, p_prev_total integer, p_renewed integer, p_new integer, p_due_keys text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m date := date_trunc('month', p_month)::date;
  this_month date := date_trunc('month', now() at time zone 'Asia/Colombo')::date;
begin
  if not public.has_page('fee_reminders') then
    raise exception 'You are not allowed to record renewals.' using errcode = '42501';
  end if;
  if m is null or coalesce(p_prev_total, -1) < 0 or coalesce(p_renewed, -1) < 0 or coalesce(p_new, -1) < 0 then
    raise exception 'Invalid renewal numbers.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.fee_classes where id = p_class) then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;

  if m = this_month then
    insert into public.fee_renewal_snapshots (class_id, month, day, prev_total, renewed, new_students, taken_at)
    values (p_class, m, (now() at time zone 'Asia/Colombo')::date, p_prev_total, p_renewed, p_new, now())
    on conflict (class_id, month, day) do update
      set prev_total = excluded.prev_total, renewed = excluded.renewed,
          new_students = excluded.new_students, taken_at = now();
  end if;

  -- Follow-ups no longer among the due students have paid (or left the list).
  update public.fee_due_followups f
  set paid_seen_at = case when f.student_key = any (coalesce(p_due_keys, '{}')) then null
                          else coalesce(f.paid_seen_at, now()) end
  where f.class_id = p_class and f.due_month = m;
end;
$$;

create or replace function public.fee_renewal_history(p_month date)
returns table (class_id uuid, day date, prev_total integer, renewed integer, new_students integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.has_page('fee_reminders') then
    raise exception 'You are not allowed to see renewals.' using errcode = '42501';
  end if;
  return query
  select s.class_id, s.day, s.prev_total, s.renewed, s.new_students
  from public.fee_renewal_snapshots s
  where s.month = date_trunc('month', p_month)::date
  order by s.class_id, s.day;
end;
$$;

create or replace function public.fee_renewal_settings()
returns table (due_day integer, target_pct integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_page('fee_reminders') then
    raise exception 'You are not allowed to see renewals.' using errcode = '42501';
  end if;
  return query
  select a.renewal_due_day::integer, a.renewal_target_pct::integer from public.app_settings a where a.id;
end;
$$;

create or replace function public.fee_renewal_settings_set(p_due_day integer, p_target_pct integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to change the renewal target.' using errcode = '42501';
  end if;
  if p_due_day is null or p_due_day not between 1 and 28 then
    raise exception 'Pick a day from 1 to 28.' using errcode = 'P0001';
  end if;
  if p_target_pct is null or p_target_pct not between 1 and 100 then
    raise exception 'Pick a share from 1 to 100%%.' using errcode = 'P0001';
  end if;
  update public.app_settings
  set renewal_due_day = p_due_day, renewal_target_pct = p_target_pct,
      updated_by = (select auth.uid()), updated_at = now()
  where id;
  perform public.write_activity('settings.renewal_target', 'settings', 'renewal', null,
    'Set the renewal target to ' || p_target_pct || '% by day ' || p_due_day,
    jsonb_build_object('due_day', p_due_day, 'target_pct', p_target_pct));
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Who needs a call, and the 9:00 notices
-- -----------------------------------------------------------------------------
create or replace function public.followup_needs_call(f public.fee_due_followups, p_today date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select f.paid_seen_at is null
     and (f.last_called_at is null or f.last_called_at <= now() - interval '1 day')
     and (
       (f.status = 'messaged' and f.message_count >= 2 and f.last_messaged_at <= now() - interval '2 days')
       or (f.status = 'promised' and f.promised_by < p_today)
     );
$$;

create or replace function public.send_renewal_notices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Colombo')::date;
  m date := date_trunc('month', now() at time zone 'Asia/Colombo')::date;
  cls record;
  who uuid;
  sent integer := 0;
begin
  for cls in
    select c.id, c.name, o.id as owner_id,
           (select count(*) from public.fee_due_followups f
             where f.class_id = c.id and f.due_month = m and public.followup_needs_call(f, today))::integer as calls,
           (select count(*) from public.fee_due_followups f
             where f.class_id = c.id and f.due_month = m and f.status = 'cant_afford'
               and f.updated_at >= now() - interval '1 day')::integer as cant_afford
    from public.fee_classes c
    left join public.profiles o on o.id = c.followup_owner_id and o.is_active
  loop
    if cls.calls > 0 then
      for who in
        select cls.owner_id where cls.owner_id is not null
        union
        select p from public.people_with_page('fee_reminders') p where cls.owner_id is null
      loop
        perform public.notify(who, 'fee.calls_due',
          cls.calls || ' student' || case when cls.calls = 1 then '' else 's' end || ' to call for ' || cls.name,
          'They had 2 reminders and haven''t paid. Note what each one says.',
          '/admin/fee-reminders/renewals', 'fee-calls:' || cls.id::text || ':' || today::text);
        sent := sent + 1;
      end loop;
    end if;
    if cls.cant_afford > 0 then
      for who in select public.people_with_page('students') loop
        perform public.notify(who, 'fee.cant_afford',
          cls.cant_afford || ' student' || case when cls.cant_afford = 1 then '' else 's' end || ' in ' || cls.name
            || ' say they can''t afford the fee',
          'Check whether a concession card can help.',
          '/admin/fee-reminders/renewals', 'fee-cant-afford:' || cls.id::text || ':' || today::text);
        sent := sent + 1;
      end loop;
    end if;
  end loop;
  return sent;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Grants and the daily job
-- -----------------------------------------------------------------------------
revoke all on function public.fee_class_owner_set(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fee_followup_outcome(uuid, date, text, text, text, text, date, text, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.fee_renewal_record(uuid, date, integer, integer, integer, text[]) from public, anon, authenticated;
revoke all on function public.fee_renewal_history(date) from public, anon, authenticated;
revoke all on function public.fee_renewal_settings() from public, anon, authenticated;
revoke all on function public.fee_renewal_settings_set(integer, integer) from public, anon, authenticated;
revoke all on function public.followup_needs_call(public.fee_due_followups, date) from public, anon, authenticated;
revoke all on function public.send_renewal_notices() from public, anon, authenticated;

grant execute on function public.fee_class_owner_set(uuid, uuid) to authenticated;
grant execute on function public.fee_followup_outcome(uuid, date, text, text, text, text, date, text, uuid, text, boolean) to authenticated;
grant execute on function public.fee_renewal_record(uuid, date, integer, integer, integer, text[]) to authenticated;
grant execute on function public.fee_renewal_history(date) to authenticated;
grant execute on function public.fee_renewal_settings() to authenticated;
grant execute on function public.fee_renewal_settings_set(integer, integer) to authenticated;

-- Every day 9:00 Sri Lanka time = 03:30 UTC (scheduling the same name again replaces it)
select cron.schedule('renewal-notices', '30 3 * * *', $$ select public.send_renewal_notices(); $$);
