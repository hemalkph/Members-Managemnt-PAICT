-- =============================================================================
-- Review limit: work should be reviewed within a set number of hours. Reviewers
-- get one reminder a day when work waits longer. Safe to run twice.
--
--   app_settings.review_limit_hours   1–168, default 24.
--   review_limit_hours()              Anyone signed in (members see "reviews usually within 24 h").
--   review_limit_set(hours)           Review editors.
--   review_waiting_summary()          Pending work for the caller: waiting, over the limit, oldest.
--   send_review_late_notices()        Every 2 hours 8:00–20:00 Sri Lanka time, once a day each.
--
-- Waiting starts when the work was sent (or sent again after a send-back). An
-- ordinary admin's own work isn't counted for them: they can't review it.
-- =============================================================================

alter table public.app_settings
  add column if not exists review_limit_hours integer not null default 24;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_review_limit_hours_check') then
    alter table public.app_settings
      add constraint app_settings_review_limit_hours_check check (review_limit_hours between 1 and 168);
  end if;
end;
$$;

create or replace function public.review_limit_hours()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.review_limit_hours from public.app_settings a where a.id), 24);
$$;

create or replace function public.review_limit_set(p_hours integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or public.has_page('review', true)) then
    raise exception 'You are not allowed to change the review limit.' using errcode = '42501';
  end if;
  if p_hours is null or p_hours not between 1 and 168 then
    raise exception 'Pick between 1 and 168 hours.' using errcode = 'P0001';
  end if;
  update public.app_settings
  set review_limit_hours = p_hours, updated_by = (select auth.uid()), updated_at = now()
  where id;
  perform public.write_activity('settings.review_limit', 'settings', 'review', null,
    'Set the review limit to ' || p_hours || ' hours', jsonb_build_object('hours', p_hours));
end;
$$;

-- Pending work the viewer could review (internal).
create or replace function public.review_waiting_items(p_viewer uuid)
returns table (id uuid, waiting_since timestamptz, work_month date)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, coalesce(s.resubmitted_at, s.created_at), s.work_month
  from public.submissions s
  where s.status = 'pending'
    and (s.user_id <> p_viewer
         or coalesce((select p.is_main_admin from public.profiles p where p.id = p_viewer), false));
$$;

create or replace function public.review_waiting_summary()
returns table (waiting integer, over_limit integer, oldest_at timestamptz, oldest_month date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := now() - make_interval(hours => public.review_limit_hours());
begin
  if not public.has_page('review') then
    raise exception 'You are not allowed to see work review.' using errcode = '42501';
  end if;
  return query
  select count(*)::integer,
         (count(*) filter (where w.waiting_since <= cutoff))::integer,
         min(w.waiting_since),
         (array_agg(w.work_month order by w.waiting_since))[1]
  from public.review_waiting_items((select auth.uid())) w;
end;
$$;

create or replace function public.send_review_late_notices()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Colombo')::date;
  lim integer := public.review_limit_hours();
  cutoff timestamptz := now() - make_interval(hours => lim);
  r record;
  age interval;
  sent integer := 0;
begin
  for r in
    select p.id as reviewer, count(*)::integer as n, min(w.waiting_since) as oldest,
           (array_agg(w.work_month order by w.waiting_since))[1] as oldest_month
    from public.profiles p
    cross join lateral public.review_waiting_items(p.id) w
    where p.is_active
      and (p.is_main_admin
           or (p.is_admin and coalesce(p.page_access ->> 'review', 'edit') = 'edit')
           or (not p.is_admin and p.page_access ->> 'review' = 'edit'))
      and w.waiting_since <= cutoff
    group by p.id
  loop
    age := now() - r.oldest;
    perform public.notify(r.reviewer, 'review.late',
      r.n || case when r.n = 1 then ' piece' else ' pieces' end || ' of work waiting over ' || lim || ' h',
      'The oldest has waited ' ||
        case when age < interval '48 hours'
             then floor(extract(epoch from age) / 3600)::integer || ' hours.'
             else floor(extract(epoch from age) / 86400)::integer || ' days.' end,
      '/admin/review?status=pending&month=' || to_char(r.oldest_month, 'YYYY-MM'),
      'review-late:' || today::text);
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

revoke all on function public.review_limit_hours() from public, anon, authenticated;
revoke all on function public.review_limit_set(integer) from public, anon, authenticated;
revoke all on function public.review_waiting_items(uuid) from public, anon, authenticated;
revoke all on function public.review_waiting_summary() from public, anon, authenticated;
revoke all on function public.send_review_late_notices() from public, anon, authenticated;
grant execute on function public.review_limit_hours() to authenticated;
grant execute on function public.review_limit_set(integer) to authenticated;
grant execute on function public.review_waiting_summary() to authenticated;

-- Every 2 hours from 8:00 to 20:00 Sri Lanka time = 02:30–14:30 UTC (scheduling the same name again replaces it)
select cron.schedule('review-late-notices', '30 2-14/2 * * *', $$ select public.send_review_late_notices(); $$);
