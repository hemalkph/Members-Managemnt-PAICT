-- =============================================================================
-- One shared tute shelf for every batch. Safe to run more than once.
--
--   * A tute no longer belongs to a batch. The same tute can be scheduled for
--     classes in any batch, and its need is the sum over all those classes.
--   * Tutes saved once per batch (same code, or same name when there is no
--     code) are merged into one: schedules, stock, print jobs and Speed Post
--     items move to the copy with the most history, then the others are deleted.
--   * Tute names and codes are unique across the whole shelf.
--   * class_tutes.batch_id is no longer used. It is kept (empty) so the older
--     migrations can still run again.
--   * Paper Library tutes have no batch again (undoes 069).
--   * The mid-month pace is still learned per batch (classes belong to a batch);
--     the Print plan shows the batch that has learned least.
-- =============================================================================

alter table public.class_tutes alter column batch_id drop not null;

-- -----------------------------------------------------------------------------
-- 1. Merge tutes that were saved once per batch
-- -----------------------------------------------------------------------------
do $$
declare
  g record;
  d uuid;
begin
  for g in
    with keyed as (
      select ct.id, ct.created_at,
             coalesce(nullif(lower(trim(ct.code)), ''), lower(trim(ct.name))) as k,
             (select count(*) from public.tute_stock_moves mv where mv.tute_id = ct.id)
               + (select count(*) from public.tute_print_jobs j where j.tute_id = ct.id) as history
      from public.class_tutes ct
    ),
    ranked as (
      select id, k, row_number() over (partition by k order by history desc, created_at, id) as rn
      from keyed
    )
    select k, (array_agg(id order by rn))[1] as keep, (array_agg(id order by rn))[2:] as drops
    from ranked
    group by k
    having count(*) > 1
  loop
    foreach d in array g.drops loop
      -- Schedules: a month the keeper already has for that class is dropped, the rest move.
      delete from public.class_month_tutes s
       where s.tute_id = d
         and exists (select 1 from public.class_month_tutes x
                     where x.tute_id = g.keep and x.class_id = s.class_id and x.month = s.month);
      update public.class_month_tutes set tute_id = g.keep where tute_id = d;
      update public.tute_stock_moves set tute_id = g.keep where tute_id = d;
      update public.tute_print_jobs set tute_id = g.keep where tute_id = d;
      -- Two active Speed Post items for the same student and month would stop this
      -- migration (unique index): that is a real double send to sort out by hand.
      update public.post_parcel_items set tute_id = g.keep where tute_id = d;
      update public.tute_stock_reservations set tute_id = g.keep where tute_id = d;

      update public.class_tutes k
         set paper_id = coalesce(k.paper_id, x.paper_id),
             cover_path = coalesce(k.cover_path, x.cover_path),
             counted_at = greatest(k.counted_at, x.counted_at)
        from public.class_tutes x
       where k.id = g.keep and x.id = d;

      perform public.write_activity('tute.merged', 'class_tute', g.keep::text, null,
        'Merged "' || (select name from public.class_tutes where id = d) || '" into "'
          || (select name from public.class_tutes where id = g.keep) || '" (one shelf for every batch)',
        jsonb_build_object('kept', g.keep, 'merged', d));

      delete from public.tute_alert_state where tute_id = d;
      delete from public.class_tutes where id = d;
    end loop;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Unique across the shelf, not per batch
-- -----------------------------------------------------------------------------
update public.class_tutes set batch_id = null where batch_id is not null;
drop index if exists public.class_tutes_batch_name_unique;
drop index if exists public.class_tutes_batch_idx;
create unique index if not exists class_tutes_name_unique on public.class_tutes (lower(name));
create unique index if not exists class_tutes_code_unique on public.class_tutes (lower(code)) where code <> '';

-- The old Fee reminders tute editors (closed in 067) still wrote a batch.
drop function if exists public.class_tute_create_and_assign(uuid, uuid, text, text, date[], text);
drop function if exists public.class_tute_update(uuid, text, text, boolean);

-- -----------------------------------------------------------------------------
-- 3. tute_save — no batch; name and code unique on the shelf
-- -----------------------------------------------------------------------------
drop function if exists public.tute_save(uuid, uuid, text, text, boolean, integer, integer, integer, uuid, integer);
drop function if exists public.tute_save(uuid, uuid, text, text, boolean, integer, integer, integer, uuid);

create or replace function public.tute_save(
  p_id uuid,
  p_name text,
  p_code text default '',
  p_is_active boolean default true,
  p_pages integer default null,
  p_reorder_level integer default null,
  p_print_batch integer default 1,
  p_paper_id uuid default null,
  p_opening_stock integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  tname text := trim(coalesce(p_name, ''));
  tcode text := trim(coalesce(p_code, ''));
  other_name text;
  t record;
  tid uuid;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to add or change tutes.' using errcode = '42501';
  end if;
  if char_length(tname) < 2 or char_length(tname) > 150 then
    raise exception 'Tute name must be between 2 and 150 characters.' using errcode = 'P0001';
  end if;
  if char_length(tcode) > 30 then
    raise exception 'Tute code must be at most 30 characters.' using errcode = 'P0001';
  end if;
  if p_paper_id is not null and not exists (select 1 from public.papers where id = p_paper_id and kind = 'tute') then
    raise exception 'Pick a tute from the Paper Library.' using errcode = 'P0001';
  end if;
  if p_opening_stock is not null and (p_opening_stock < 0 or p_opening_stock > 100000) then
    raise exception 'Opening stock must be between 0 and 100,000.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.class_tutes where lower(name) = lower(tname) and id is distinct from p_id) then
    raise exception 'A tute named "%" already exists.', tname using errcode = 'P0001';
  end if;
  if tcode <> '' then
    select name into other_name from public.class_tutes
     where lower(code) = lower(tcode) and id is distinct from p_id
     limit 1;
    if other_name is not null then
      raise exception 'Code "%" is already used by "%".', tcode, other_name using errcode = 'P0001';
    end if;
  end if;

  if p_id is null then
    -- An opening stock of 0 is a count too (the shelf is empty).
    insert into public.class_tutes (code, name, is_active, pages, reorder_level, print_batch, paper_id, created_by, counted_at)
    values (tcode, tname, coalesce(p_is_active, true), p_pages, p_reorder_level, coalesce(p_print_batch, 1),
            p_paper_id, (select auth.uid()), case when p_opening_stock is not null then now() end)
    returning id into tid;

    if p_opening_stock is not null and p_opening_stock > 0 then
      insert into public.tute_stock_moves (tute_id, qty, kind, note, created_by)
      values (tid, p_opening_stock, 'opening_stock', 'Opening stock', (select auth.uid()));
    end if;

    perform public.write_activity('tute.created', 'class_tute', tid::text, null,
      'Added tute "' || tname || '"' || case when coalesce(p_opening_stock, 0) > 0 then ' (' || p_opening_stock || ' opening copies)' else '' end,
      jsonb_build_object('code', tcode, 'opening_stock', p_opening_stock));
    return tid;
  end if;

  select id, name into t from public.class_tutes where id = p_id for update;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  update public.class_tutes
     set name = tname,
         code = tcode,
         is_active = coalesce(p_is_active, true),
         pages = p_pages,
         reorder_level = p_reorder_level,
         print_batch = coalesce(p_print_batch, 1),
         paper_id = p_paper_id
   where id = p_id;
  perform public.write_activity('tute.changed', 'class_tute', p_id::text, null,
    case when t.name <> tname then 'Renamed tute "' || t.name || '" to "' || tname || '"'
         else 'Changed tute "' || tname || '"' end,
    jsonb_build_object('code', tcode, 'is_active', coalesce(p_is_active, true), 'pages', p_pages,
                       'reorder_level', p_reorder_level, 'print_batch', p_print_batch, 'paper_id', p_paper_id));
  return p_id;
end;
$$;

revoke all on function public.tute_save(uuid, text, text, boolean, integer, integer, integer, uuid, integer) from public, anon;
grant execute on function public.tute_save(uuid, text, text, boolean, integer, integer, integer, uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. tute_paper_options — every Paper Library tute
-- -----------------------------------------------------------------------------
drop function if exists public.tute_paper_options(uuid);

create or replace function public.tute_paper_options()
returns table (id uuid, title text, medium text)
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
  select p.id, p.title, p.medium from public.papers p
  where p.kind = 'tute' and p.status <> 'cancelled'
  order by lower(p.title);
end;
$$;

revoke all on function public.tute_paper_options() from public, anon;
grant execute on function public.tute_paper_options() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Scheduling and handing out — any class can take any tute
-- -----------------------------------------------------------------------------
create or replace function public.class_month_tute_attach(
  p_class_id uuid,
  p_month date,
  p_tute_id uuid,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  m date := date_trunc('month', p_month)::date;
  cls record;
  tute record;
  next_pos integer;
  link_id uuid;
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to manage class tutes.' using errcode = '42501';
  end if;
  select id, name into cls from public.fee_classes where id = p_class_id;
  if cls.id is null then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;
  select id, name into tute from public.class_tutes where id = p_tute_id;
  if tute.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;

  select coalesce(max(sort_order), -1) + 1 into next_pos
    from public.class_month_tutes
   where class_id = p_class_id and month = m;

  insert into public.class_month_tutes (class_id, month, tute_id, sort_order, note, added_by)
  values (p_class_id, m, p_tute_id, next_pos, left(trim(coalesce(p_note, '')), 200), actor)
  on conflict (class_id, month, tute_id) do update set
    note = case when excluded.note <> '' then excluded.note else class_month_tutes.note end
  returning id into link_id;

  perform public.write_activity('fee.tute_assigned', 'fee_class', p_class_id::text, null,
    'Scheduled "' || tute.name || '" for ' || cls.name || ' (' || public.month_name(m) || ')',
    jsonb_build_object('class_id', p_class_id, 'tute_id', p_tute_id, 'month', m));

  return link_id;
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
  free integer;
  held integer;
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
  select id, name into t from public.class_tutes where id = p_tute for update;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  if p_kind = 'class_issue' then
    select id, name into cls from public.fee_classes where id = p_class;
    if cls.id is null then
      raise exception 'Pick the class the copies were given to.' using errcode = 'P0001';
    end if;
    class_name := cls.name;
  end if;

  select coalesce(sum(qty), 0)::integer into have from public.tute_stock_moves where tute_id = p_tute;
  if p_kind = 'class_issue' then
    free := public.tute_available(p_tute);
    held := greatest(have - free, 0);
    if free < p_qty then
      if held > 0 then
        raise exception 'Only % copies free (% on hand, % held for Speed Post).', greatest(free, 0), have, held
          using errcode = 'P0001';
      end if;
      raise exception 'Only % copies on hand.', have using errcode = 'P0001';
    end if;
  else
    if have < p_qty then
      raise exception 'Only % copies on hand.', have using errcode = 'P0001';
    end if;
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
    select coalesce(sum(-qty), 0)::integer into given from public.tute_stock_moves
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

revoke all on function public.tute_stock_issue(uuid, integer, text, uuid, date, text) from public, anon;
grant execute on function public.tute_stock_issue(uuid, integer, text, uuid, date, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Mid-month pace status for the whole shelf
-- -----------------------------------------------------------------------------
drop function if exists public.tute_pace_status(uuid);

-- Each batch learns its own payment pace; report the one that has learned least.
create or replace function public.tute_pace_status()
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
  return query
  select coalesce(min(s.samples), 0)::integer, 4
  from public.batches b
  cross join lateral public.tute_pace_share(b.id, 31) s
  where exists (select 1 from public.fee_classes fc where fc.batch_id = b.id and fc.is_active);
end;
$$;

revoke all on function public.tute_pace_status() from public, anon;
grant execute on function public.tute_pace_status() to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Levels and stock summary — the whole shelf
-- -----------------------------------------------------------------------------
drop function if exists public.tute_stock_summary(uuid, date);
drop function if exists public.tute_levels(date, uuid);

create or replace function public.tute_levels(p_month date)
returns table (
  tute_id uuid, name text, is_active boolean, reorder_level integer,
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
      ct.id, ct.name, ct.is_active, ct.reorder_level,
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
      (ct.counted_at is not null
        or exists (select 1 from public.tute_stock_moves mv where mv.tute_id = ct.id)
        or exists (select 1 from public.tute_print_jobs j where j.tute_id = ct.id)) as has_record,
      exists (select 1 from public.class_month_tutes s where s.tute_id = ct.id and s.month = p_month) as scheduled_this,
      exists (select 1 from public.class_month_tutes s
              where s.tute_id = ct.id and s.month = (p_month + interval '1 month')::date) as scheduled_next
    from public.class_tutes ct
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
    x.id, x.name, x.is_active, x.reorder_level, x.on_hand, x.in_print, x.open_jobs,
    x.need_this, x.given_this, x.need_next, x.need_after, x.safety, x.loss_extra,
    x.scheduled_this, x.scheduled_next,
    case when not x.has_record then 'not_counted'
         else public.tute_status(x.on_hand, x.in_print, greatest(x.need_this - x.given_this, 0),
                                 x.need_next + x.safety + x.loss_extra,
                                 x.reorder_level, x.scheduled_this, x.scheduled_next) end
  from extra x;
$$;

revoke all on function public.tute_levels(date) from public, anon, authenticated;

-- Classes that have a tute in a month, with their batch, expected students,
-- forecast and Hall / Speed Post split.
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
           'batch', b.name,
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
                                and mv.month = p_month and mv.kind in ('class_issue', 'post_out')), 0),
           'hall_given', coalesce((select sum(-mv.qty) from public.tute_stock_moves mv
                                   where mv.tute_id = p_tute and mv.class_id = fc.id
                                     and mv.month = p_month and mv.kind = 'class_issue'), 0))
         order by b.sort_order, b.name, fc.name), '[]'::jsonb)
  from public.class_month_tutes s
  join public.fee_classes fc on fc.id = s.class_id
  join public.batches b on b.id = fc.batch_id
  cross join lateral public.tute_class_forecast(fc.id, p_month) f
  cross join lateral (
    select
      public.tute_expected_students(fc.id, p_month) as expected,
      (select i.unique_student_count from public.fee_month_imports i
        where i.class_id = fc.id and i.month = p_month) as paid
  ) x
  where s.tute_id = p_tute and s.month = p_month;
$$;
revoke all on function public.tute_class_rows(uuid, date) from public, anon, authenticated;

create or replace function public.tute_stock_summary(p_month date)
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
    join public.tute_levels(m) l on l.tute_id = ct.id
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

revoke all on function public.tute_stock_summary(date) from public, anon;
grant execute on function public.tute_stock_summary(date) to authenticated;

-- The forecast report card covers every batch when p_batch is null.
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
  where (p_batch is null or fc.batch_id = p_batch) and fc.is_active and f.method <> 'none'
  order by fc.name, i.month;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Paper Library tutes have no batch again (undoes 069)
-- -----------------------------------------------------------------------------
drop function if exists public.create_paper(text, text, uuid, text, jsonb, text, text, date, uuid);

create or replace function public.create_paper(
  p_title text,
  p_kind text,
  p_exam uuid,
  p_notes text,
  p_stages jsonb,
  p_medium text default 'both',
  p_part text default 'full',
  p_exam_day date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paper uuid;
  s record;
  stage_id uuid;
  owner uuid;
  start_d date;
  due date;
  skip boolean;
  exam_name text;
begin
  if not public.has_page('papers', true) then
    raise exception 'Only admins can add papers.' using errcode = '42501';
  end if;
  if p_kind not in ('paper', 'tute') then
    raise exception 'Choose paper or tute.' using errcode = 'P0001';
  end if;
  if p_medium not in ('si', 'both') then
    raise exception 'Choose the medium.' using errcode = 'P0001';
  end if;
  if p_part not in ('mcq', 'essay', 'full') then
    raise exception 'Choose the paper part.' using errcode = 'P0001';
  end if;

  select e.name into exam_name from public.exams e where e.id = p_exam;

  insert into public.papers (title, kind, exam_id, notes, created_by, medium, part, exam_day)
  values (trim(p_title), p_kind, p_exam, nullif(trim(p_notes), ''), (select auth.uid()), p_medium, p_part, p_exam_day)
  returning id into v_paper;

  for s in
    select * from (values
      ('create_si', 1), ('typeset_si', 2), ('convert', 3), ('typeset_en', 4),
      ('review_si', 5), ('review_en', 6), ('handover', 7),
      ('scheme', 8), ('scheme_rewrite', 9), ('scheme_en', 10), ('mark', 11)
    ) as v(stage, position)
  loop
    select (e ->> 'owner_id')::uuid, nullif(e ->> 'start_date', '')::date, nullif(e ->> 'due_date', '')::date,
           coalesce((e ->> 'skip')::boolean, false)
      into owner, start_d, due, skip
    from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb)) e
    where e ->> 'stage' = s.stage
    limit 1;

    skip := coalesce(skip, false);
    if p_medium = 'si' and s.stage in ('convert', 'typeset_en', 'review_en', 'scheme_en') then
      skip := true;
    end if;
    if start_d is not null and due is not null and start_d > due then
      raise exception '%: the start date is after the due date.', public.stage_label(s.stage) using errcode = 'P0001';
    end if;
    if owner is not null and not exists (select 1 from public.profiles where id = owner and is_active) then
      raise exception 'Choose an active member for every stage.' using errcode = 'P0001';
    end if;

    insert into public.paper_stages (paper_id, stage, position, owner_id, start_date, due_date, status)
    values (v_paper, s.stage, s.position, case when skip then null else owner end,
            case when skip then null else start_d end, case when skip then null else due end,
            case when skip then 'skipped' else 'waiting' end)
    returning id into stage_id;

    if not skip and owner is not null then
      insert into public.tasks (title, description, assignee_id, exam_id, due_date, status, paper_stage_id, created_by)
      values (public.stage_label(s.stage) || ': ' || trim(p_title),
              public.stage_task_description(start_d, due),
              owner, p_exam, due, 'waiting', stage_id, (select auth.uid()));
    end if;
    owner := null; start_d := null; due := null; skip := null;
  end loop;

  if not exists (select 1 from public.paper_stages where paper_stages.paper_id = v_paper and status = 'waiting') then
    raise exception 'Keep at least one stage.' using errcode = 'P0001';
  end if;

  perform public.write_activity('paper.created', 'paper', v_paper::text, null,
    'Added the ' || p_kind || ' "' || trim(p_title) || '"' || coalesce(' for ' || exam_name, ''),
    jsonb_build_object('paper_id', v_paper, 'exam_id', p_exam, 'medium', p_medium, 'part', p_part));

  perform public.advance_paper(v_paper);
  return v_paper;
end;
$$;

revoke all on function public.create_paper(text, text, uuid, text, jsonb, text, text, date) from public, anon;
grant execute on function public.create_paper(text, text, uuid, text, jsonb, text, text, date) to authenticated;

create or replace function public.paper_library()
returns table (
  file_id uuid, paper_id uuid, title text, kind text, part text, medium text, exam_day date,
  exam_name text, batch_name text, stage text, version integer, file_name text, size_bytes bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (f.paper_id, f.stage)
         f.id, p.id, p.title, p.kind, p.part, p.medium, p.exam_day, e.name, b.name,
         f.stage, f.version, f.file_name, f.size_bytes, f.created_at
  from public.paper_files f
  join public.papers p on p.id = f.paper_id
  left join public.exams e on e.id = p.exam_id
  left join public.batches b on b.id = e.batch_id
  where (public.is_active_member() or public.is_admin())
    and f.stage in ('typeset_si', 'typeset_en', 'handover', 'scheme', 'scheme_rewrite', 'scheme_en')
    and public.library_file_ok(f.paper_id, f.stage)
  order by f.paper_id, f.stage, f.is_main desc, f.version desc;
$$;

revoke all on function public.paper_library() from public, anon;
grant execute on function public.paper_library() to authenticated;

alter table public.papers drop column if exists batch_id;
