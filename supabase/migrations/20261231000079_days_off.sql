-- =============================================================================
-- Days off: members mark the days they're away, so whoever assigns work can
-- see it (and gets a warning when a deadline lands on one). Safe to run twice.
--
--   member_days_off   One range of days per row (up to 90 days).
--   day_off_add       Your own days off; admins can add for anyone.
--   day_off_delete    Your own; admins any.
--   team_days_off     Admins and people who assign work see everyone's dates;
--                     notes only to admins and the member themself.
-- Reminders and overdue alerts don't change: days off only warn.
-- =============================================================================

create table if not exists public.member_days_off (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  day_from   date not null,
  day_to     date not null,
  note       text not null default '' check (char_length(note) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (day_to >= day_from and day_to <= day_from + 90)
);
create index if not exists member_days_off_user_idx on public.member_days_off (user_id, day_to);

alter table public.member_days_off enable row level security;
revoke all on table public.member_days_off from public, anon, authenticated;

create or replace function public.day_off_add(p_from date, p_to date, p_note text default '', p_user uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target uuid := coalesce(p_user, (select auth.uid()));
  today date := (now() at time zone 'Asia/Colombo')::date;
  new_id uuid;
begin
  if actor is null or not exists (select 1 from public.profiles where id = actor and is_active) then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;
  if target <> actor and not public.is_admin() then
    raise exception 'Only admins can add days off for someone else.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = target and is_active) then
    raise exception 'Choose an active member.' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to > p_from + 90 then
    raise exception 'Pick a range of up to 90 days.' using errcode = 'P0001';
  end if;
  if p_to < today then
    raise exception 'Pick days from today on.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.member_days_off d
    where d.user_id = target and d.day_from <= p_to and d.day_to >= p_from
  ) then
    raise exception 'These days overlap days off already saved.' using errcode = 'P0001';
  end if;

  insert into public.member_days_off (user_id, day_from, day_to, note, created_by)
  values (target, p_from, p_to, left(trim(coalesce(p_note, '')), 200), actor)
  returning id into new_id;

  perform public.write_activity('member.day_off_added', 'profile', target::text, target,
    coalesce(public.profile_name(target), 'A member') || ' is away ' || to_char(p_from, 'FMDD Mon')
      || case when p_to > p_from then ' – ' || to_char(p_to, 'FMDD Mon') else '' end,
    jsonb_build_object('from', p_from, 'to', p_to));
  return new_id;
end;
$$;

create or replace function public.day_off_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_user uuid;
  row_from date;
  row_to date;
begin
  select d.user_id, d.day_from, d.day_to into row_user, row_from, row_to from public.member_days_off d where d.id = p_id;
  if row_user is null then
    raise exception 'Day off not found.' using errcode = 'P0001';
  end if;
  if row_user <> (select auth.uid()) and not public.is_admin() then
    raise exception 'You can only remove your own days off.' using errcode = '42501';
  end if;
  delete from public.member_days_off where id = p_id;
  perform public.write_activity('member.day_off_removed', 'profile', row_user::text, row_user,
    'Removed days off ' || to_char(row_from, 'FMDD Mon')
      || case when row_to > row_from then ' – ' || to_char(row_to, 'FMDD Mon') else '' end,
    jsonb_build_object('from', row_from, 'to', row_to));
end;
$$;

create or replace function public.team_days_off(p_from date, p_to date)
returns table (id uuid, user_id uuid, day_from date, day_to date, note text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := (select auth.uid());
  admin boolean := public.is_admin();
  sees_all boolean;
begin
  if me is null then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to > p_from + 400 then
    raise exception 'Choose at most 400 days.' using errcode = 'P0001';
  end if;
  sees_all := admin or public.has_page('tasks') or public.has_page('papers')
              or public.has_page('class_ops') or public.has_page('fee_reminders');
  return query
  select d.id, d.user_id, d.day_from, d.day_to,
         case when admin or d.user_id = me then d.note else '' end
  from public.member_days_off d
  where d.day_from <= p_to and d.day_to >= p_from
    and (sees_all or d.user_id = me)
  order by d.day_from, d.user_id;
end;
$$;

revoke all on function public.day_off_add(date, date, text, uuid) from public, anon, authenticated;
revoke all on function public.day_off_delete(uuid) from public, anon, authenticated;
revoke all on function public.team_days_off(date, date) from public, anon, authenticated;
grant execute on function public.day_off_add(date, date, text, uuid) to authenticated;
grant execute on function public.day_off_delete(uuid) to authenticated;
grant execute on function public.team_days_off(date, date) to authenticated;
