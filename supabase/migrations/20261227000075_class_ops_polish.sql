-- =============================================================================
-- Classes (/admin/class-ops) polish & fixes. Safe to run more than once.
--
--   * tute-covers read policy includes class_ops so Classes viewers see booklet
--     cover thumbnails on Tute plan and Add tutes.
--   * send_tute_stock_alerts allows class_ops / fee_reminders editors to trigger
--     alerts when paid counts or tute schedules shift stock demand.
--   * class_month_tute_attach skips no-op duplicate activity logs and refreshes
--     stock alerts; class_month_tute_remove refreshes stock alerts too.
--   * class_paid_count_save refreshes stock alerts for scheduled tutes.
--   * class_paid_count_undo removes a mistakenly typed count (last 10 minutes).
--   * class_month_tutes_copy copies one class's tute plan into another month.
-- =============================================================================

-- 1. Let Classes viewers read private tute cover thumbnails
drop policy if exists "tute-covers: page read" on storage.objects;
create policy "tute-covers: page read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tute-covers'
    and (
      (select public.has_page('tutes'))
      or (select public.has_page('fee_reminders'))
      or (select public.has_page('post'))
      or (select public.has_page('class_ops'))
    )
  );

-- 2. Stock alerts can also be triggered by Classes / Fee reminders editors
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
  -- The daily job runs with no user; people may only trigger it with Tute stock,
  -- or when editing Classes / Fee reminders that directly change tute demand.
  if (select auth.uid()) is not null
     and not public.has_page('tutes')
     and not public.has_page('class_ops', true)
     and not public.has_page('fee_reminders', true) then
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

-- 3. class_month_tute_attach: avoid duplicate activity logs on no-op conflicts & refresh alerts
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
  clean_note text := left(trim(coalesce(p_note, '')), 200);
  cls record;
  tute record;
  existing record;
  next_pos integer;
  link_id uuid;
begin
  if not (public.has_page('class_ops', true) or public.has_page('fee_reminders', true)) then
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

  select id, note into existing
    from public.class_month_tutes
   where class_id = p_class_id and month = m and tute_id = p_tute_id;

  if existing.id is not null then
    if clean_note <> '' and clean_note <> existing.note then
      update public.class_month_tutes set note = clean_note where id = existing.id;
    end if;
    return existing.id;
  end if;

  select coalesce(max(sort_order), -1) + 1 into next_pos
    from public.class_month_tutes
   where class_id = p_class_id and month = m;

  insert into public.class_month_tutes (class_id, month, tute_id, sort_order, note, added_by)
  values (p_class_id, m, p_tute_id, next_pos, clean_note, actor)
  on conflict (class_id, month, tute_id) do update set
    note = case when excluded.note <> '' then excluded.note else class_month_tutes.note end
  returning id into link_id;

  perform public.write_activity('fee.tute_assigned', 'fee_class', p_class_id::text, null,
    'Scheduled "' || tute.name || '" for ' || cls.name || ' (' || public.month_name(m) || ')',
    jsonb_build_object('class_id', p_class_id, 'tute_id', p_tute_id, 'month', m));

  perform public.send_tute_stock_alerts(p_tute_id);
  return link_id;
end;
$$;

-- 4. class_month_tute_remove: refresh stock alerts for the removed tute
create or replace function public.class_month_tute_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_info record;
begin
  if not (public.has_page('class_ops', true) or public.has_page('fee_reminders', true)) then
    raise exception 'You are not allowed to manage class tutes.' using errcode = '42501';
  end if;
  select cmt.id, cmt.class_id, cmt.tute_id, cmt.month, fc.name as class_name, ct.name as tute_name
    into row_info
    from public.class_month_tutes cmt
    join public.fee_classes fc on fc.id = cmt.class_id
    join public.class_tutes ct on ct.id = cmt.tute_id
   where cmt.id = p_id;
  if row_info.id is null then
    raise exception 'Scheduled tute not found.' using errcode = 'P0001';
  end if;
  delete from public.class_month_tutes where id = p_id;
  perform public.write_activity('fee.tute_unassigned', 'fee_class', row_info.class_id::text, null,
    'Removed "' || row_info.tute_name || '" from ' || row_info.class_name || ' (' || public.month_name(row_info.month) || ')',
    jsonb_build_object('class_id', row_info.class_id, 'month', row_info.month));
  perform public.send_tute_stock_alerts(row_info.tute_id);
end;
$$;

-- 5. class_paid_count_save: refresh stock alerts for this class's scheduled tutes
create or replace function public.class_paid_count_save(p_class uuid, p_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  t uuid;
  m date := date_trunc('month', now() at time zone 'Asia/Colombo')::date;
begin
  if not (public.has_page('class_ops', true) or public.has_page('fee_reminders', true)) then
    raise exception 'You are not allowed to update class counts.' using errcode = '42501';
  end if;
  if p_count is null or p_count < 0 or p_count > 100000 then
    raise exception 'Paid students must be between 0 and 100,000.' using errcode = 'P0001';
  end if;
  select id, name into c from public.fee_classes where id = p_class;
  if c.id is null then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;
  insert into public.fee_month_upload_log (class_id, month, student_count, uploaded_at, source, added_by)
  values (p_class, m, p_count, now(), 'typed', (select auth.uid()));
  perform public.write_activity('class.paid_count', 'fee_class', p_class::text, null,
    c.name || ': ' || p_count || ' paid so far (' || public.month_name(m) || ')',
    jsonb_build_object('class_id', p_class, 'month', m, 'count', p_count));

  for t in
    select distinct s.tute_id
      from public.class_month_tutes s
     where s.class_id = p_class
       and s.month in (m, (m + interval '1 month')::date)
  loop
    perform public.send_tute_stock_alerts(t);
  end loop;
end;
$$;

-- 6. class_paid_count_undo: undo a mistakenly typed count from the last 10 minutes
create or replace function public.class_paid_count_undo(p_class uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  last_row record;
  t uuid;
  m date := date_trunc('month', now() at time zone 'Asia/Colombo')::date;
begin
  if not (public.has_page('class_ops', true) or public.has_page('fee_reminders', true)) then
    raise exception 'You are not allowed to update class counts.' using errcode = '42501';
  end if;
  select id, name into c from public.fee_classes where id = p_class;
  if c.id is null then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;

  select id, student_count into last_row
    from public.fee_month_upload_log
   where class_id = p_class
     and month = m
     and source = 'typed'
     and uploaded_at >= now() - interval '10 minutes'
   order by uploaded_at desc, id desc
   limit 1
   for update;

  if last_row.id is null then
    raise exception 'Nothing recent to undo for this class.' using errcode = 'P0001';
  end if;

  delete from public.fee_month_upload_log where id = last_row.id;

  perform public.write_activity('class.paid_count_undone', 'fee_class', p_class::text, null,
    c.name || ': undid typed count ' || last_row.student_count || ' (' || public.month_name(m) || ')',
    jsonb_build_object('class_id', p_class, 'month', m, 'undone_count', last_row.student_count));

  for t in
    select distinct s.tute_id
      from public.class_month_tutes s
     where s.class_id = p_class
       and s.month in (m, (m + interval '1 month')::date)
  loop
    perform public.send_tute_stock_alerts(t);
  end loop;

  return last_row.student_count;
end;
$$;

revoke all on function public.class_paid_count_undo(uuid) from public, anon, authenticated;
grant execute on function public.class_paid_count_undo(uuid) to authenticated;

-- 7. class_month_tutes_copy: copy one class's tute schedule into another month
create or replace function public.class_month_tutes_copy(
  p_class uuid,
  p_from_month date,
  p_to_month date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  from_m date := date_trunc('month', p_from_month)::date;
  to_m date := date_trunc('month', p_to_month)::date;
  cls record;
  src record;
  next_pos integer;
  added integer := 0;
  added_tutes uuid[] := array[]::uuid[];
  t uuid;
begin
  if not (public.has_page('class_ops', true) or public.has_page('fee_reminders', true)) then
    raise exception 'You are not allowed to manage class tutes.' using errcode = '42501';
  end if;
  if from_m = to_m then
    raise exception 'Choose two different months.' using errcode = 'P0001';
  end if;
  select id, name into cls from public.fee_classes where id = p_class;
  if cls.id is null then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;

  select coalesce(max(sort_order), -1) + 1 into next_pos
    from public.class_month_tutes
   where class_id = p_class and month = to_m;

  for src in
    select s.tute_id, s.note
      from public.class_month_tutes s
      join public.class_tutes ct on ct.id = s.tute_id and ct.is_active
     where s.class_id = p_class and s.month = from_m
     order by s.sort_order, s.created_at
  loop
    insert into public.class_month_tutes (class_id, month, tute_id, sort_order, note, added_by)
    values (p_class, to_m, src.tute_id, next_pos, src.note, actor)
    on conflict (class_id, month, tute_id) do nothing;
    if found then
      next_pos := next_pos + 1;
      added := added + 1;
      added_tutes := array_append(added_tutes, src.tute_id);
    end if;
  end loop;

  if added > 0 then
    perform public.write_activity('fee.tute_assigned', 'fee_class', p_class::text, null,
      'Copied ' || added || ' tute' || case when added = 1 then '' else 's' end
        || ' for ' || cls.name || ' (' || public.month_name(from_m) || ' → ' || public.month_name(to_m) || ')',
      jsonb_build_object('class_id', p_class, 'from_month', from_m, 'to_month', to_m, 'added', added));
    foreach t in array added_tutes loop
      perform public.send_tute_stock_alerts(t);
    end loop;
  end if;

  return added;
end;
$$;

revoke all on function public.class_month_tutes_copy(uuid, date, date) from public, anon, authenticated;
grant execute on function public.class_month_tutes_copy(uuid, date, date) to authenticated;
