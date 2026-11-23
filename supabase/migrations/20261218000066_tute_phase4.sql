-- =============================================================================
-- Tute inventory & Speed Post, Phase 4 (docs/TUTE_INVENTORY_PLAN.md). Safe to run more than once.
--
--   * Mid-month forecast: from the upload log, how much of a month's final paid
--     count is usually in by a given day. An early upload this month is scaled up
--     to a month-end estimate. Learned per batch; switches on after 4 past
--     class-months in the batch that each had more than one upload.
--   * Return-risk flag: parcels likely to come back (came back before, a district
--     that often returns, an unclear address, no WhatsApp). A past return always flags. Switches on after 30
--     posted parcels have a known outcome.
--   * Weekly summary: Monday 9:00, one notification with what needs doing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Mid-month forecast
-- -----------------------------------------------------------------------------

-- Usual share of the final count that is in by day p_day of the month, for a batch
-- (median of its past class-months that had at least two uploads), and how many
-- class-months it learned from.
drop function if exists public.tute_pace_share(integer);
create or replace function public.tute_pace_share(p_batch uuid, p_day integer)
returns table (share numeric, samples integer)
language sql
stable
security definer
set search_path = ''
as $$
  with finals as (
    select i.class_id, i.month, i.unique_student_count as final
    from public.fee_month_imports i
    join public.fee_classes fc on fc.id = i.class_id and fc.batch_id = p_batch
    where i.month < date_trunc('month', now() at time zone 'Asia/Colombo')::date
      and i.unique_student_count > 0
      and (select count(*) from public.fee_month_upload_log l
           where l.class_id = i.class_id and l.month = i.month) >= 2
  ),
  points as (
    select f.final,
      (select l.student_count from public.fee_month_upload_log l
        where l.class_id = f.class_id and l.month = f.month
          and ((l.uploaded_at at time zone 'Asia/Colombo')::date - f.month) + 1 <= p_day
        order by l.uploaded_at desc
        limit 1) as by_day
    from finals f
  )
  select
    (select percentile_cont(0.5) within group (order by least(p.by_day::numeric / p.final, 1))
       from points p where p.by_day is not null)::numeric,
    (select count(*) from finals)::integer;
$$;

-- This month's paid list scaled up to a month-end estimate, or null while still learning.
create or replace function public.tute_paced_expected(p_class uuid, p_month date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.samples >= 4 and s.share >= 0.2 and s.share < 1 then ceil(cur.c / s.share)::integer end
  from (
    select i.unique_student_count as c,
           ((i.uploaded_at at time zone 'Asia/Colombo')::date - i.month) + 1 as day,
           fc.batch_id
    from public.fee_month_imports i
    join public.fee_classes fc on fc.id = i.class_id
    where i.class_id = p_class and i.month = p_month
      and p_month = date_trunc('month', now() at time zone 'Asia/Colombo')::date
  ) cur
  cross join lateral public.tute_pace_share(cur.batch_id, cur.day::integer) s;
$$;

-- Past months use their paid list; this month and later use the paid list, the
-- forecast or the mid-month estimate, whichever is highest.
create or replace function public.tute_expected_students(p_class uuid, p_month date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_month < date_trunc('month', now() at time zone 'Asia/Colombo')::date and up.c is not null then up.c
    else greatest(coalesce(up.c, 0),
                  (select f.expected from public.tute_class_forecast(p_class, p_month) f),
                  coalesce(public.tute_paced_expected(p_class, p_month), 0))
  end
  from (
    select (select i.unique_student_count from public.fee_month_imports i
            where i.class_id = p_class and i.month = p_month) as c
  ) up;
$$;

-- Class rows now say what was paid so far and the mid-month estimate.
create or replace function public.tute_class_rows(p_tute uuid, p_month date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', fc.id,
           'name', fc.name,
           'expected', x.expected,
           'online', round(x.expected * public.tute_online_share(fc.id, p_month))::integer,
           'uploaded', x.paid is not null,
           'paid', x.paid,
           'pace', public.tute_paced_expected(fc.id, p_month),
           'low', f.low,
           'high', f.high,
           'method', f.method,
           'given', coalesce((select sum(-mv.qty) from public.tute_stock_moves mv
                              where mv.tute_id = p_tute and mv.class_id = fc.id
                                and mv.month = p_month and mv.kind in ('class_issue', 'post_out')), 0))
         order by fc.name), '[]'::jsonb)
  from public.class_month_tutes s
  join public.fee_classes fc on fc.id = s.class_id
  cross join lateral public.tute_class_forecast(fc.id, p_month) f
  cross join lateral (
    select
      public.tute_expected_students(fc.id, p_month) as expected,
      (select i.unique_student_count from public.fee_month_imports i
        where i.class_id = fc.id and i.month = p_month) as paid
  ) x
  where s.tute_id = p_tute and s.month = p_month;
$$;

-- For the Print plan: is the mid-month forecast on yet?
drop function if exists public.tute_pace_status();
create or replace function public.tute_pace_status(p_batch uuid)
returns table (samples integer, needed integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.has_page('tutes') then
    raise exception 'You are not allowed to see tute stock.' using errcode = '42501';
  end if;
  return query select s.samples, 4 from public.tute_pace_share(p_batch, 31) s;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Return-risk flag
-- -----------------------------------------------------------------------------

-- Posted parcels with a known outcome (posted over 30 days ago counts as arrived).
create or replace function public.post_risk_learning()
returns table (resolved integer, returned integer, needed integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.has_page('post') then
    raise exception 'You are not allowed to see Speed Post.' using errcode = '42501';
  end if;
  return query
  select
    count(*) filter (where p.status in ('delivered', 'returned', 'lost')
                        or (p.status = 'handed_over' and p.status_at < now() - interval '30 days'))::integer,
    count(*) filter (where p.status = 'returned')::integer,
    30
  from public.post_parcels p;
end;
$$;

-- Parcels in a round that may come back, with the reason in plain words.
-- Empty until 30 posted parcels have a known outcome.
create or replace function public.post_round_risks(p_round uuid)
returns table (parcel_id uuid, risk numeric, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  done_n integer;
  back_n integer;
  overall numeric;
begin
  if not public.has_page('post') then
    raise exception 'You are not allowed to see Speed Post.' using errcode = '42501';
  end if;
  select l.resolved, l.returned into done_n, back_n from public.post_risk_learning() l;
  if done_n < 30 then
    return;
  end if;
  overall := back_n::numeric / done_n;

  return query
  with history as (
    select p.district,
           count(*) filter (where p.status in ('delivered', 'returned', 'lost')
                               or (p.status = 'handed_over' and p.status_at < now() - interval '30 days')) as done,
           count(*) filter (where p.status = 'returned') as back
    from public.post_parcels p
    group by p.district
  ),
  scored as (
    select
      pp.id,
      pp.district,
      coalesce(h.done, 0) as d_done,
      coalesce(h.back, 0) as d_back,
      -- District rate, pulled toward the overall rate while a district has few parcels.
      (coalesce(h.back, 0) + 5 * overall) / (coalesce(h.done, 0) + 5) as d_rate,
      exists (select 1 from public.post_parcel_items mine
              join public.post_parcel_items old on old.student_key = mine.student_key
              join public.post_parcels op on op.id = old.parcel_id and op.status = 'returned'
              where mine.parcel_id = pp.id)
        or exists (select 1 from public.post_parcels op
                   where op.status = 'returned' and op.id <> pp.id
                     and public.post_address_key(op.address) = public.post_address_key(pp.address)) as came_back,
      public.post_address_problem(pp.address) as problem,
      pp.whatsapp is null as no_phone
    from public.post_parcels pp
    left join history h on h.district = pp.district
    where pp.round_id = p_round and pp.status in ('planned', 'packed')
  ),
  risk as (
    select s.*,
           least(1, s.d_rate
                    + case when s.came_back then 0.5 else 0 end
                    + case when s.problem <> '' then 0.15 else 0 end
                    + case when s.no_phone then 0.05 else 0 end) as r
    from scored s
  )
  select r.id, round(r.r, 2),
    array_to_string(array_remove(array[
      case when r.came_back then 'came back before' end,
      case when r.district <> '' and r.d_done > 0 and r.d_back::numeric / r.d_done >= 2 * overall and r.d_back > 0
           then r.district || ': ' || r.d_back || ' of ' || r.d_done || ' came back' end,
      case when r.problem <> '' then 'address: ' || lower(r.problem) end,
      case when r.no_phone then 'no WhatsApp number' end
    ], null), '; ')
  from risk r
  where r.r >= greatest(0.15, 2 * overall)
  order by r.r desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Weekly summary (Monday 9:00)
-- -----------------------------------------------------------------------------
create or replace function public.people_with_page(p_page text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.is_active
    and (p.is_main_admin
         or (p.is_admin and coalesce(p.page_access ->> p_page, 'edit') in ('edit', 'view'))
         or (not p.is_admin and p.page_access ->> p_page in ('edit', 'view')));
$$;

create or replace function public.send_tute_weekly_summary()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Colombo')::date;
  week text := to_char(today, 'IYYY-IW');
  stock_text text;
  post_text text;
  who record;
  body text;
  sent integer := 0;
begin
  select array_to_string(array_remove(array[
    case when x.out_n > 0 then x.out_n || ' tute' || case when x.out_n = 1 then '' else 's' end || ' out of stock' end,
    case when x.low_n > 0 then x.low_n || ' running low' end,
    case when x.late_n > 0 then x.late_n || ' print job' || case when x.late_n = 1 then '' else 's' end || ' late' end,
    case when x.due_n > 0 then x.due_n || ' print job' || case when x.due_n = 1 then '' else 's' end || ' due this week' end
  ], null), ', ')
  into stock_text
  from (
    select
      (select count(*) from public.tute_alert_state s join public.class_tutes ct on ct.id = s.tute_id
        where ct.is_active and s.level = 'out') as out_n,
      (select count(*) from public.tute_alert_state s join public.class_tutes ct on ct.id = s.tute_id
        where ct.is_active and s.level = 'low') as low_n,
      (select count(*) from public.tute_print_jobs where status in ('planned', 'printing') and due_date < today) as late_n,
      (select count(*) from public.tute_print_jobs
        where status in ('planned', 'printing') and due_date between today and today + 7) as due_n
  ) x;

  select array_to_string(array_remove(array[
    case when y.to_pack > 0 then y.to_pack || ' parcel' || case when y.to_pack = 1 then '' else 's' end || ' to pack' end,
    case when y.posted > 0 then y.posted || ' posted last week' end,
    case when y.back > 0 then y.back || ' came back' end
  ], null), ', ')
  into post_text
  from (
    select
      (select count(*) from public.post_parcels p join public.post_rounds r on r.id = p.round_id
        where r.status = 'packing' and p.status in ('planned', 'packed')) as to_pack,
      (select count(*) from public.post_parcels
        where status_at >= now() - interval '7 days' and status in ('handed_over', 'delivered')) as posted,
      (select count(*) from public.post_parcels
        where status = 'returned' and status_at >= now() - interval '7 days') as back
  ) y;

  for who in
    select u.id,
           u.id in (select public.people_with_page('tutes')) as tutes,
           u.id in (select public.people_with_page('post')) as post
    from (select public.people_with_page('tutes') as id union select public.people_with_page('post')) u
  loop
    body := array_to_string(array_remove(array[
      case when who.tutes and stock_text <> '' then 'Stock: ' || stock_text || '.' end,
      case when who.post and post_text <> '' then 'Speed Post: ' || post_text || '.' end
    ], null), ' ');
    continue when body = '';
    perform public.notify(who.id, 'tute.weekly', 'Tutes this week', body,
      case when who.tutes then '/admin/tutes?tab=plan' else '/admin/post' end,
      'tute-weekly:' || week);
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Grants
-- -----------------------------------------------------------------------------
revoke all on function public.tute_pace_share(uuid, integer) from public, anon, authenticated;
revoke all on function public.tute_paced_expected(uuid, date) from public, anon, authenticated;
revoke all on function public.people_with_page(text) from public, anon, authenticated;
revoke all on function public.send_tute_weekly_summary() from public, anon, authenticated;

revoke all on function public.tute_pace_status(uuid) from public, anon;
revoke all on function public.post_risk_learning() from public, anon;
revoke all on function public.post_round_risks(uuid) from public, anon;
grant execute on function public.tute_pace_status(uuid) to authenticated;
grant execute on function public.post_risk_learning() to authenticated;
grant execute on function public.post_round_risks(uuid) to authenticated;

-- Monday 9:00 Sri Lanka time = 03:30 UTC (scheduling the same name again replaces it)
select cron.schedule('tute-weekly-summary', '30 3 * * 1', $$ select public.send_tute_weekly_summary(); $$);
