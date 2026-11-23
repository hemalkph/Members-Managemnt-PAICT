-- =============================================================================
-- Tute inventory, Phase 2: print planner (docs/TUTE_INVENTORY_PLAN.md).
-- Safe to run more than once.
--
--   * Student forecast per class that picks its own method (tested on the
--     class's own past months), with a range from its own past errors.
--   * "Needed" now uses the forecast when a month's paid list isn't in yet.
--   * Safety stock (1.65 × forecast error) and the usual loss rate are added
--     to the need; status, alerts and the print plan all use them.
--   * Real print times are learned per printer (drives "not ready" alerts).
--   * Odd counts and handouts are flagged on the move and sent as an alert.
--
-- Everything is computed live from the uploaded paid lists, so there is
-- nothing to keep in sync. A forecast for a month only ever uses months
-- before it, so the report card can recompute past forecasts exactly.
-- =============================================================================

alter table public.tute_stock_moves
  add column if not exists flag text not null default '' check (char_length(flag) <= 300);

-- -----------------------------------------------------------------------------
-- 1. Forecast
-- -----------------------------------------------------------------------------

-- Predict k months after h[1..upto] with one simple method.
create or replace function public.tute_predict(h numeric[], upto integer, method text, k integer)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  l numeric;
  b numeric := 0;
  lp numeric;
  i integer;
begin
  if upto < 1 then
    return 0;
  end if;
  case method
    when 'last_month' then
      return h[upto];
    when 'avg3' then
      return (select avg(h[j]) from generate_series(greatest(1, upto - 2), upto) j);
    when 'smooth' then
      l := h[1];
      for i in 2 .. upto loop
        l := 0.5 * h[i] + 0.5 * l;
      end loop;
      return l;
    when 'trend' then
      l := h[1];
      if upto >= 2 then
        b := h[2] - h[1];
      end if;
      for i in 2 .. upto loop
        lp := l;
        l := 0.5 * h[i] + 0.5 * (l + b);
        b := 0.3 * (l - lp) + 0.7 * b;
      end loop;
      return greatest(l + k * b, 0);
    else
      return h[upto];
  end case;
end;
$$;

-- How a class behaves month to month: share of students who pay again, and new students.
create or replace function public.tute_class_habits(p_class uuid, p_before date)
returns table (pay_again numeric, new_avg numeric, pairs integer)
language sql
stable
security definer
set search_path = ''
as $$
  with months as (
    select distinct month from public.fee_month_students where class_id = p_class and month < p_before
  ),
  pairs as (
    select
      m.month,
      (select count(*) from public.fee_month_students s
        where s.class_id = p_class and s.month = (m.month - interval '1 month')::date) as prev_n,
      (select count(*) from public.fee_month_students s
        where s.class_id = p_class and s.month = m.month
          and exists (select 1 from public.fee_month_students p
                      where p.class_id = p_class and p.month = (m.month - interval '1 month')::date
                        and p.student_key = s.student_key)) as again_n,
      (select count(*) from public.fee_month_students s
        where s.class_id = p_class and s.month = m.month
          and not exists (select 1 from public.fee_month_students p
                          where p.class_id = p_class and p.month = (m.month - interval '1 month')::date
                            and p.student_key = s.student_key)) as new_n
    from months m
    where exists (select 1 from months p where p.month = (m.month - interval '1 month')::date)
  )
  select
    avg(again_n::numeric / nullif(prev_n, 0)),
    avg(new_n::numeric),
    count(*)::integer
  from pairs;
$$;

-- Expected paid students for a class in a month, from months before it only.
--   4+ months of history: four methods are tested on the class's own past
--   months and the most accurate (lowest average miss) is used.
--   Fewer: last month × pay-again rate + new students (or just last month).
create or replace function public.tute_class_forecast(p_class uuid, p_month date)
returns table (expected integer, low integer, high integer, method text, months_used integer, error numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h numeric[];
  last_month date;
  n integer;
  k integer;
  m text;
  best text;
  best_mae numeric;
  best_rmse numeric;
  abs_sum numeric;
  sq_sum numeric;
  cnt integer;
  t integer;
  miss numeric;
  e numeric;
  err numeric;
  hab record;
  step integer;
begin
  select array_agg(x.c order by x.month), max(x.month) into h, last_month
  from (
    select fmi.month, fmi.unique_student_count::numeric as c
    from public.fee_month_imports fmi
    where fmi.class_id = p_class and fmi.month < p_month
    order by fmi.month desc
    limit 24
  ) x;
  n := coalesce(array_length(h, 1), 0);
  if n = 0 then
    return query select 0, 0, 0, 'none'::text, 0, 0::numeric;
    return;
  end if;
  k := greatest(((extract(year from p_month) - extract(year from last_month)) * 12
                 + extract(month from p_month) - extract(month from last_month))::integer, 1);

  if n >= 4 then
    foreach m in array array['last_month', 'avg3', 'smooth', 'trend'] loop
      abs_sum := 0; sq_sum := 0; cnt := 0;
      for t in 3 .. n - 1 loop
        miss := public.tute_predict(h, t, m, 1) - h[t + 1];
        abs_sum := abs_sum + abs(miss);
        sq_sum := sq_sum + miss * miss;
        cnt := cnt + 1;
      end loop;
      if best is null or abs_sum / cnt < best_mae then
        best := m;
        best_mae := abs_sum / cnt;
        best_rmse := sqrt(sq_sum / cnt);
      end if;
    end loop;
    e := public.tute_predict(h, n, best, k);
    err := best_rmse;
  else
    select * into hab from public.tute_class_habits(p_class, p_month);
    e := h[n];
    if coalesce(hab.pairs, 0) > 0 and hab.pay_again is not null then
      best := 'start_rule';
      for step in 1 .. k loop
        e := e * hab.pay_again + coalesce(hab.new_avg, 0);
      end loop;
    else
      best := 'last_month';
    end if;
    -- Little history: assume about 10% either way.
    err := 0.1 * e;
  end if;

  return query select
    round(e)::integer,
    greatest(round(e - err), 0)::integer,
    round(e + err)::integer,
    best,
    n,
    round(err, 2);
end;
$$;

-- Students expected in a class for a month. Past months with a paid list use
-- it; this month and later use the paid list or the forecast, whichever is higher.
create or replace function public.tute_expected_students(p_class uuid, p_month date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_month < date_trunc('month', now() at time zone 'Asia/Colombo')::date and up.c is not null then up.c
    else greatest(coalesce(up.c, 0), (select f.expected from public.tute_class_forecast(p_class, p_month) f))
  end
  from (
    select (select i.unique_student_count from public.fee_month_imports i
            where i.class_id = p_class and i.month = p_month) as c
  ) up;
$$;

-- Share of a class's students who study Online (from the latest paid list up to the month).
create or replace function public.tute_online_share(p_class uuid, p_month date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select max(month) as month from public.fee_month_students where class_id = p_class and month <= p_month
  )
  select coalesce(
    (select avg(case when s.institute ilike '%online%' then 1 else 0 end)::numeric
     from public.fee_month_students s, latest
     where s.class_id = p_class and s.month = latest.month),
    0);
$$;

-- Days a tute's printer really takes: its last 5 received jobs, else its usual days, else 7.
create or replace function public.tute_lead_days(p_tute uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with printer as (
    select pj.printer_id
    from public.tute_print_jobs pj
    where pj.tute_id = p_tute and pj.printer_id is not null
    order by pj.created_at desc
    limit 1
  ),
  learned as (
    select round(avg(extract(epoch from (j.received_at - j.created_at)) / 86400))::integer as days
    from (
      select pj.received_at, pj.created_at
      from public.tute_print_jobs pj, printer
      where pj.printer_id = printer.printer_id and pj.received_at is not null
      order by pj.received_at desc
      limit 5
    ) j
  )
  select coalesce(
    (select greatest(days, 1) from learned),
    (select p.usual_days from public.tute_printers p join printer on printer.printer_id = p.id),
    7);
$$;

-- -----------------------------------------------------------------------------
-- 2. Stock and need per tute (now with safety stock and usual loss)
-- -----------------------------------------------------------------------------
drop function if exists public.tute_levels(date, uuid);
create function public.tute_levels(p_month date, p_batch uuid default null)
returns table (
  tute_id uuid, batch_id uuid, name text, is_active boolean, reorder_level integer,
  on_hand integer, in_print integer, open_jobs integer,
  need_this integer, given_this integer, need_next integer, need_after integer,
  safety integer, loss_extra integer,
  scheduled_this boolean, scheduled_next boolean, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      ct.id, ct.batch_id, ct.name, ct.is_active, ct.reorder_level,
      coalesce((select sum(mv.qty) from public.tute_stock_moves mv where mv.tute_id = ct.id), 0)::integer as on_hand,
      coalesce((select sum(greatest(j.qty - j.received_qty, 0)) from public.tute_print_jobs j
                where j.tute_id = ct.id and j.status in ('planned', 'printing')), 0)::integer as in_print,
      (select count(*) from public.tute_print_jobs j
        where j.tute_id = ct.id and j.status in ('planned', 'printing'))::integer as open_jobs,
      coalesce((select sum(public.tute_expected_students(s.class_id, s.month)) from public.class_month_tutes s
                where s.tute_id = ct.id and s.month = p_month), 0)::integer as need_this,
      coalesce((select sum(-mv.qty) from public.tute_stock_moves mv
                where mv.tute_id = ct.id and mv.month = p_month and mv.kind in ('class_issue', 'post_out')), 0)::integer as given_this,
      coalesce((select sum(public.tute_expected_students(s.class_id, s.month)) from public.class_month_tutes s
                where s.tute_id = ct.id and s.month = (p_month + interval '1 month')::date), 0)::integer as need_next,
      coalesce((select sum(public.tute_expected_students(s.class_id, s.month)) from public.class_month_tutes s
                where s.tute_id = ct.id and s.month = (p_month + interval '2 months')::date), 0)::integer as need_after,
      -- Forecast error of the months that are still guesses (no paid list yet).
      coalesce((select sqrt(sum(f.error * f.error)) from public.class_month_tutes s
                cross join lateral public.tute_class_forecast(s.class_id, s.month) f
                where s.tute_id = ct.id
                  and s.month in (p_month, (p_month + interval '1 month')::date)
                  and not exists (select 1 from public.fee_month_imports i
                                  where i.class_id = s.class_id and i.month = s.month)), 0) as forecast_error,
      -- Copies lost (damaged, counted short) per copy given out, last 6 months.
      coalesce((select sum(-mv.qty) filter (where mv.kind = 'damaged' or (mv.kind = 'count_fix' and mv.qty < 0))::numeric
                       / nullif(sum(-mv.qty) filter (where mv.kind in ('class_issue', 'post_out')), 0)
                from public.tute_stock_moves mv
                where mv.tute_id = ct.id and mv.created_at > now() - interval '6 months'), 0) as loss_rate,
      exists (select 1 from public.class_month_tutes s where s.tute_id = ct.id and s.month = p_month) as scheduled_this,
      exists (select 1 from public.class_month_tutes s
              where s.tute_id = ct.id and s.month = (p_month + interval '1 month')::date) as scheduled_next
    from public.class_tutes ct
    where p_batch is null or ct.batch_id = p_batch
  ),
  demand as (
    select b.*, greatest(b.need_this - b.given_this, 0) + b.need_next as still_needed from base b
  ),
  extra as (
    select
      d.*,
      case when d.still_needed = 0 then 0
           else greatest(ceil(1.65 * d.forecast_error), ceil(0.05 * d.still_needed), 5)::integer end as safety,
      ceil(d.loss_rate * d.still_needed)::integer as loss_extra
    from demand d
  )
  select
    x.id, x.batch_id, x.name, x.is_active, x.reorder_level, x.on_hand, x.in_print, x.open_jobs,
    x.need_this, x.given_this, x.need_next, x.need_after, x.safety, x.loss_extra,
    x.scheduled_this, x.scheduled_next,
    public.tute_status(x.on_hand, x.in_print, greatest(x.need_this - x.given_this, 0),
                       x.need_next + x.safety + x.loss_extra,
                       x.reorder_level, x.scheduled_this, x.scheduled_next)
  from extra x;
$$;

-- -----------------------------------------------------------------------------
-- 3. Stock summary + print plan (one row per tute)
-- -----------------------------------------------------------------------------
drop function if exists public.tute_stock_summary(uuid, date);
create function public.tute_stock_summary(p_batch uuid, p_month date)
returns table (
  tute_id uuid, code text, name text, is_active boolean, pages integer, print_batch integer,
  reorder_level integer, paper_id uuid, paper_ready boolean,
  on_hand integer, in_print integer, open_jobs integer,
  need_this integer, given_this integer, need_next integer, need_after integer,
  safety integer, loss_extra integer, print_now integer, lead_days integer, print_by date,
  status text, classes jsonb, classes_next jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  m date := date_trunc('month', coalesce(p_month, current_date))::date;
  nxt date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month')::date;
  today date := (now() at time zone 'Asia/Colombo')::date;
begin
  if not public.has_page('tutes') then
    raise exception 'You are not allowed to see tute stock.' using errcode = '42501';
  end if;
  return query
  with t_rows as (
    select
      ct.id, ct.code, ct.name, ct.is_active, ct.pages, ct.print_batch, ct.reorder_level, ct.paper_id,
      (ct.paper_id is not null and (public.library_file_ok(ct.paper_id, 'typeset_si')
                                    or public.library_file_ok(ct.paper_id, 'typeset_en')
                                    or public.library_file_ok(ct.paper_id, 'handover'))) as paper_ready,
      l.on_hand, l.in_print, l.open_jobs, l.need_this, l.given_this, l.need_next, l.need_after,
      l.safety, l.loss_extra, l.status,
      greatest(l.need_this - l.given_this, 0) + l.need_next + l.safety + l.loss_extra - l.on_hand - l.in_print as short,
      public.tute_lead_days(ct.id) as lead_days
    from public.class_tutes ct
    join public.tute_levels(m, p_batch) l on l.tute_id = ct.id
  )
  select
    r.id, r.code, r.name, r.is_active, r.pages, r.print_batch, r.reorder_level, r.paper_id, r.paper_ready,
    r.on_hand, r.in_print, r.open_jobs, r.need_this, r.given_this, r.need_next, r.need_after,
    r.safety, r.loss_extra,
    case when r.short > 0 then (ceil(r.short::numeric / greatest(r.print_batch, 1)) * greatest(r.print_batch, 1))::integer
         else 0 end,
    r.lead_days,
    case
      when r.short <= 0 then null
      -- Not enough for what is still to give this month: print now.
      when r.on_hand + r.in_print < greatest(r.need_this - r.given_this, 0) then today
      else greatest(nxt - r.lead_days - 3, today)
    end,
    r.status,
    public.tute_class_rows(r.id, m),
    public.tute_class_rows(r.id, nxt)
  from t_rows r
  order by r.is_active desc, lower(r.name);
end;
$$;

-- Classes that have a tute in a month, with expected students, forecast and split.
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
           'uploaded', x.uploaded,
           'low', f.low,
           'high', f.high,
           'method', f.method,
           'given', coalesce((select sum(-mv.qty) from public.tute_stock_moves mv
                              where mv.tute_id = p_tute and mv.class_id = fc.id
                                and mv.month = p_month and mv.kind = 'class_issue'), 0))
         order by fc.name), '[]'::jsonb)
  from public.class_month_tutes s
  join public.fee_classes fc on fc.id = s.class_id
  cross join lateral public.tute_class_forecast(fc.id, p_month) f
  cross join lateral (
    select
      public.tute_expected_students(fc.id, p_month) as expected,
      exists (select 1 from public.fee_month_imports i where i.class_id = fc.id and i.month = p_month) as uploaded
  ) x
  where s.tute_id = p_tute and s.month = p_month;
$$;

-- Report card: forecast vs real paid count for each class's last 3 uploaded months.
create or replace function public.tute_forecast_report(p_batch uuid)
returns table (class_id uuid, class_name text, month date, forecast integer, actual integer, method text)
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
  return query
  select fc.id, fc.name, i.month, f.expected, i.unique_student_count, f.method
  from public.fee_classes fc
  join lateral (
    select i.month, i.unique_student_count from public.fee_month_imports i
    where i.class_id = fc.id
    order by i.month desc
    limit 3
  ) i on true
  cross join lateral public.tute_class_forecast(fc.id, i.month) f
  where fc.batch_id = p_batch and fc.is_active and f.method <> 'none'
  order by fc.name, i.month;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Alerts: "not ready" uses the learned print time
-- -----------------------------------------------------------------------------
create or replace function public.send_tute_stock_alerts(p_tute uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Colombo')::date;
  m date := date_trunc('month', today)::date;
  nxt date := (date_trunc('month', today) + interval '1 month')::date;
  r record;
  j record;
  who uuid;
  prev text;
  lvl text;
  lead integer;
  sent integer := 0;
begin
  -- The daily job runs with no user; people may only trigger it with the page.
  if (select auth.uid()) is not null and not public.has_page('tutes') then
    return 0;
  end if;

  for r in
    select * from public.tute_levels(m) l
    where l.is_active and (p_tute is null or l.tute_id = p_tute)
  loop
    lvl := case when r.status in ('low', 'out') then r.status else 'ok' end;
    select s.level into prev from public.tute_alert_state s where s.tute_id = r.tute_id;
    prev := coalesce(prev, 'ok');

    -- Low / out: once each time it gets worse; recovering resets it.
    if (lvl = 'low' and prev = 'ok') or (lvl = 'out' and prev <> 'out') then
      for who in select public.tute_alert_people() loop
        perform public.notify(
          who,
          'tute.' || lvl,
          case lvl when 'out' then 'Out of stock: ' else 'Low stock: ' end || r.name,
          'On hand ' || r.on_hand || ', printing ' || r.in_print || '. Still needed: '
            || greatest(r.need_this - r.given_this, 0) || ' this month, ' || r.need_next || ' next month (+'
            || (r.safety + r.loss_extra) || ' spare).',
          '/admin/tutes?tab=plan',
          'tute-' || lvl || ':' || r.tute_id || ':' || today);
        sent := sent + 1;
      end loop;
    end if;
    if lvl is distinct from prev then
      insert into public.tute_alert_state (tute_id, level, updated_at)
      values (r.tute_id, lvl, now())
      on conflict (tute_id) do update set level = excluded.level, updated_at = excluded.updated_at;
    end if;

    -- Next month is close and nothing is being printed for it.
    if r.scheduled_next and r.open_jobs = 0 and r.on_hand < r.need_next then
      lead := public.tute_lead_days(r.tute_id);
      if today >= nxt - (lead + 3) then
        for who in select public.tute_alert_people() loop
          perform public.notify(
            who,
            'tute.not_ready',
            'Not ready for ' || public.month_name(nxt) || ': ' || r.name,
            'About ' || r.need_next || ' copies needed, ' || r.on_hand || ' on hand. Printing takes about '
              || lead || ' days, so start a print job now.',
            '/admin/tutes?tab=plan',
            'tute-not-ready:' || r.tute_id || ':' || nxt);
          sent := sent + 1;
        end loop;
      end if;
    end if;
  end loop;

  -- Print jobs past their due date.
  for j in
    select pj.id, pj.due_date, ct.name, coalesce(p.name, '') as printer
    from public.tute_print_jobs pj
    join public.class_tutes ct on ct.id = pj.tute_id
    left join public.tute_printers p on p.id = pj.printer_id
    where pj.status in ('planned', 'printing') and pj.due_date < today
      and (p_tute is null or pj.tute_id = p_tute)
  loop
    for who in select public.tute_alert_people() loop
      perform public.notify(
        who,
        'tute.job_late',
        'Print job late: ' || j.name,
        'It was due ' || to_char(j.due_date, 'FMDD Mon YYYY')
          || case when j.printer <> '' then ' at ' || j.printer else '' end
          || '. Mark it received when the copies arrive.',
        '/admin/tutes?tab=jobs',
        'tute-job-late:' || j.id);
      sent := sent + 1;
    end loop;
  end loop;

  return sent;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Odd-number check on counts and handouts
-- -----------------------------------------------------------------------------
create or replace function public.tute_flag_move(p_move uuid, p_tute_name text, p_flag text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid;
begin
  update public.tute_stock_moves set flag = left(p_flag, 300) where id = p_move;
  for who in select public.tute_alert_people() loop
    perform public.notify(who, 'tute.odd', 'Check the numbers: ' || p_tute_name, left(p_flag, 500),
      '/admin/tutes?tab=history', 'tute-odd:' || p_move);
  end loop;
end;
$$;

create or replace function public.tute_stock_issue(
  p_tute uuid, p_qty integer, p_kind text, p_class uuid default null,
  p_month date default null, p_note text default ''
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  cls record;
  class_name text := '';
  have integer;
  given integer;
  expected integer;
  move_id uuid;
  m date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Colombo')::date))::date;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to change tute stock.' using errcode = '42501';
  end if;
  if p_kind not in ('class_issue', 'damaged') then
    raise exception 'Unknown stock change.' using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    raise exception 'Copies must be between 1 and 100,000.' using errcode = 'P0001';
  end if;
  select id, name, batch_id into t from public.class_tutes where id = p_tute for update;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  if p_kind = 'class_issue' then
    select id, name, batch_id into cls from public.fee_classes where id = p_class;
    if cls.id is null or cls.batch_id <> t.batch_id then
      raise exception 'Pick the class the copies were given to.' using errcode = 'P0001';
    end if;
    class_name := cls.name;
  end if;
  select coalesce(sum(qty), 0) into have from public.tute_stock_moves where tute_id = p_tute;
  if have < p_qty then
    raise exception 'Only % copies on hand.', have using errcode = 'P0001';
  end if;

  insert into public.tute_stock_moves (tute_id, qty, kind, class_id, month, note, created_by)
  values (p_tute, -p_qty, p_kind, case when p_kind = 'class_issue' then p_class end, m,
          left(trim(coalesce(p_note, '')), 300), (select auth.uid()))
  returning id into move_id;
  perform public.write_activity('tute.' || p_kind, 'class_tute', p_tute::text, null,
    case p_kind
      when 'class_issue' then 'Gave ' || p_qty || ' copies of "' || t.name || '" to ' || class_name
      else 'Marked ' || p_qty || ' copies of "' || t.name || '" damaged'
    end,
    jsonb_build_object('qty', p_qty, 'class_id', p_class, 'month', m));

  -- More copies given to a class than it has students (20% + 5 leeway)?
  if p_kind = 'class_issue' then
    select coalesce(sum(-qty), 0) into given from public.tute_stock_moves
     where tute_id = p_tute and class_id = p_class and month = m and kind = 'class_issue';
    expected := public.tute_expected_students(p_class, m);
    if expected > 0 and given > expected * 1.2 + 5 then
      perform public.tute_flag_move(move_id, t.name,
        given || ' copies given to ' || class_name || ' for ' || public.month_name(m) || ', but about '
          || expected || ' students are expected. Check the number.');
    end if;
  end if;

  perform public.send_tute_stock_alerts(p_tute);
  return have - p_qty;
end;
$$;

create or replace function public.tute_stock_count(p_tute uuid, p_counted integer, p_note text default '')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  have integer;
  first_count boolean;
  diff integer;
  usual numeric;
  move_id uuid;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to change tute stock.' using errcode = '42501';
  end if;
  if p_counted is null or p_counted < 0 or p_counted > 100000 then
    raise exception 'Count must be between 0 and 100,000.' using errcode = 'P0001';
  end if;
  select id, name into t from public.class_tutes where id = p_tute for update;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  first_count := not exists (select 1 from public.tute_stock_moves where tute_id = p_tute);
  select coalesce(sum(qty), 0) into have from public.tute_stock_moves where tute_id = p_tute;
  diff := p_counted - have;
  if diff = 0 then
    return 0;
  end if;
  -- The usual size of this tute's count fixes (median of the last 10).
  select percentile_cont(0.5) within group (order by abs(x.qty)) into usual
  from (select qty from public.tute_stock_moves
        where tute_id = p_tute and kind = 'count_fix' order by created_at desc limit 10) x;

  insert into public.tute_stock_moves (tute_id, qty, kind, note, created_by)
  values (p_tute, diff, case when first_count then 'opening_stock' else 'count_fix' end,
          left(trim(coalesce(p_note, '')), 300), (select auth.uid()))
  returning id into move_id;
  perform public.write_activity(case when first_count then 'tute.opening_stock' else 'tute.count_fix' end,
    'class_tute', p_tute::text, null,
    case when first_count
      then 'Opening stock for "' || t.name || '": ' || p_counted
      else 'Counted "' || t.name || '": ' || p_counted || ' (' || case when diff > 0 then '+' else '' end || diff || ')'
    end,
    jsonb_build_object('counted', p_counted, 'change', diff));

  -- A big difference compared with this tute's usual ones (or 20% of the record the first time).
  if not first_count and abs(diff) >= 10
     and ((usual is null and abs(diff) > 0.2 * greatest(have, 1))
          or (usual is not null and abs(diff) > 3 * greatest(usual, 1))) then
    perform public.tute_flag_move(move_id, t.name,
      'Count is ' || abs(diff) || case when diff < 0 then ' below' else ' above' end || ' the record'
        || case when usual is not null
             then ', about ' || round(abs(diff) / greatest(usual, 1)) || '× more than usual'
             else '' end
        || '. Check the shelf and the last handouts.');
  end if;

  perform public.send_tute_stock_alerts(p_tute);
  return diff;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Grants
-- -----------------------------------------------------------------------------
revoke all on function public.tute_predict(numeric[], integer, text, integer) from public, anon, authenticated;
revoke all on function public.tute_class_habits(uuid, date) from public, anon, authenticated;
revoke all on function public.tute_class_forecast(uuid, date) from public, anon, authenticated;
revoke all on function public.tute_online_share(uuid, date) from public, anon, authenticated;
revoke all on function public.tute_lead_days(uuid) from public, anon, authenticated;
revoke all on function public.tute_levels(date, uuid) from public, anon, authenticated;
revoke all on function public.tute_class_rows(uuid, date) from public, anon, authenticated;
revoke all on function public.tute_flag_move(uuid, text, text) from public, anon, authenticated;

revoke all on function public.tute_stock_summary(uuid, date) from public, anon;
revoke all on function public.tute_forecast_report(uuid) from public, anon;
grant execute on function public.tute_stock_summary(uuid, date) to authenticated;
grant execute on function public.tute_forecast_report(uuid) to authenticated;
