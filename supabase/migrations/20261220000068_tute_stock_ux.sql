-- =============================================================================
-- Tute stock UX, flow & safety improvements. Safe to run more than once.
--
--   1. tute_stock_issue: class handouts ('class_issue') check free copies
--      (on hand minus Speed Post reservations) so hall handouts can't take
--      copies already held for an open Speed Post round.
--   2. tute_class_rows: adds hall_given (class_issue only) alongside given
--      (class_issue + post_out) so "Give out" suggests Hall copies left.
--   3. tute_save: adds optional p_opening_stock when creating a new tute,
--      saving its initial opening_stock ledger row in the same call.
--   4. tute_print_job_receive: adds optional p_cost so staff can record or
--      update the final press invoice cost when copies arrive.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. tute_class_rows — include hall_given separately from Speed Post post_out
-- -----------------------------------------------------------------------------
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
                                and mv.month = p_month and mv.kind in ('class_issue', 'post_out')), 0),
           'hall_given', coalesce((select sum(-mv.qty) from public.tute_stock_moves mv
                                   where mv.tute_id = p_tute and mv.class_id = fc.id
                                     and mv.month = p_month and mv.kind = 'class_issue'), 0))
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

revoke all on function public.tute_class_rows(uuid, date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. tute_stock_issue — respect copies held for open Speed Post rounds
-- -----------------------------------------------------------------------------
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
-- 3. tute_save — optional opening stock on creation (one atomic step)
-- -----------------------------------------------------------------------------
drop function if exists public.tute_save(uuid, uuid, text, text, boolean, integer, integer, integer, uuid);

create or replace function public.tute_save(
  p_id uuid,
  p_batch uuid,
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

  if p_id is null then
    if not exists (select 1 from public.batches where id = p_batch) then
      raise exception 'Batch not found.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.class_tutes where batch_id = p_batch and lower(name) = lower(tname)) then
      raise exception 'A tute named "%" already exists in this batch.', tname using errcode = 'P0001';
    end if;
    insert into public.class_tutes (batch_id, code, name, is_active, pages, reorder_level, print_batch, paper_id, created_by)
    values (p_batch, tcode, tname, coalesce(p_is_active, true), p_pages, p_reorder_level, coalesce(p_print_batch, 1),
            p_paper_id, (select auth.uid()))
    returning id into tid;

    if p_opening_stock is not null and p_opening_stock > 0 then
      insert into public.tute_stock_moves (tute_id, qty, kind, note, created_by)
      values (tid, p_opening_stock, 'opening_stock', 'Opening stock', (select auth.uid()));
    end if;

    perform public.write_activity('tute.created', 'class_tute', tid::text, null,
      'Added tute "' || tname || '"' || case when coalesce(p_opening_stock, 0) > 0 then ' (' || p_opening_stock || ' opening copies)' else '' end,
      jsonb_build_object('batch_id', p_batch, 'code', tcode, 'opening_stock', p_opening_stock));
    return tid;
  end if;

  select id, batch_id, name into t from public.class_tutes where id = p_id for update;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.class_tutes where batch_id = t.batch_id and lower(name) = lower(tname) and id <> p_id) then
    raise exception 'A tute named "%" already exists in this batch.', tname using errcode = 'P0001';
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

revoke all on function public.tute_save(uuid, uuid, text, text, boolean, integer, integer, integer, uuid, integer) from public, anon;
grant execute on function public.tute_save(uuid, uuid, text, text, boolean, integer, integer, integer, uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. tute_print_job_receive — allow recording/updating invoice cost on arrival
-- -----------------------------------------------------------------------------
drop function if exists public.tute_print_job_receive(uuid, integer);

create or replace function public.tute_print_job_receive(
  p_id uuid, p_qty integer, p_cost numeric default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j record;
  total integer;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to receive print jobs.' using errcode = '42501';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    raise exception 'Copies must be between 1 and 100,000.' using errcode = 'P0001';
  end if;
  if p_cost is not null and (p_cost < 0 or p_cost > 100000000) then
    raise exception 'Cost must be between 0 and 100,000,000.' using errcode = 'P0001';
  end if;
  select pj.id, pj.status, pj.qty, pj.received_qty, pj.tute_id into j
    from public.tute_print_jobs pj
   where pj.id = p_id
     for update;
  if j.id is null then
    raise exception 'Print job not found.' using errcode = 'P0001';
  end if;
  if j.status not in ('planned', 'printing') then
    raise exception 'This print job is already closed.' using errcode = 'P0001';
  end if;
  perform 1 from public.class_tutes where id = j.tute_id for update;

  total := j.received_qty + p_qty;
  insert into public.tute_stock_moves (tute_id, qty, kind, ref_id, note, created_by)
  values (j.tute_id, p_qty, 'print_in', p_id, 'Print job', (select auth.uid()));
  update public.tute_print_jobs
     set received_qty = total,
         cost = coalesce(p_cost, cost),
         started_at = coalesce(started_at, now()),
         status = case when total >= qty then 'received' else 'printing' end,
         received_at = case when total >= qty then now() else received_at end
   where id = p_id;
  perform public.write_activity('tute.print_job_received', 'tute_print_job', p_id::text, null,
    'Received ' || p_qty || ' printed copies (' || total || ' of ' || j.qty || ')',
    jsonb_build_object('tute_id', j.tute_id, 'qty', p_qty, 'received_total', total, 'cost', p_cost));
  perform public.send_tute_stock_alerts(j.tute_id);
  return total;
end;
$$;

revoke all on function public.tute_print_job_receive(uuid, integer, numeric) from public, anon;
grant execute on function public.tute_print_job_receive(uuid, integer, numeric) to authenticated;
