-- =============================================================================
-- Classes page (operations unit). Safe to run more than once.
--
--   * New page "class_ops" (Classes), assignable to members: create classes,
--     plan tutes month by month and keep each class's paid count up to date.
--   * fee_classes.mode: physical, online or both. "Both" splits students by the
--     paid list's Institute column (as before); the others are all one way.
--   * A typed "paid so far" count (fee_month_upload_log, source 'typed') counts
--     like an upload: class_paid_count() is the newest of the uploaded list and
--     typed counts, and every tute forecast uses it.
--   * Classes editors can also save classes and schedule tutes; Fee reminders
--     editors still can (a paid-list upload may create a class).
-- =============================================================================

alter table public.fee_classes add column if not exists mode text not null default 'both';
alter table public.fee_classes drop constraint if exists fee_classes_mode_check;
alter table public.fee_classes add constraint fee_classes_mode_check check (mode in ('physical', 'online', 'both'));

alter table public.fee_month_upload_log add column if not exists source text not null default 'upload';
alter table public.fee_month_upload_log drop constraint if exists fee_month_upload_log_source_check;
alter table public.fee_month_upload_log add constraint fee_month_upload_log_source_check check (source in ('upload', 'typed'));
alter table public.fee_month_upload_log add column if not exists added_by uuid references public.profiles (id) on delete set null;

-- -----------------------------------------------------------------------------
-- 1. Page access: "class_ops" can be given to members
-- -----------------------------------------------------------------------------
create or replace function public.has_page(p_page text, p_edit boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then false
      when p.is_admin and p.is_main_admin then true
      when p.is_admin then
        case coalesce(p.page_access ->> p_page, 'edit')
          when 'edit' then true
          when 'view' then not p_edit
          else false
        end
      when p_page = any (array['papers', 'tasks', 'classes', 'notices', 'student_results', 'students', 'fee_reminders', 'tutes', 'post', 'class_ops']) then
        case p.page_access ->> p_page
          when 'edit' then true
          when 'view' then not p_edit
          else false
        end
      else false
    end
    from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  ), false);
$$;

-- Class, tute and schedule names for the Classes page.
drop policy if exists "fee_classes: page read" on public.fee_classes;
create policy "fee_classes: page read" on public.fee_classes for select to authenticated
  using ((select public.has_page('fee_reminders')) or (select public.has_page('tutes'))
         or (select public.has_page('post')) or (select public.has_page('class_ops')));
drop policy if exists "class_tutes: page read" on public.class_tutes;
create policy "class_tutes: page read" on public.class_tutes for select to authenticated
  using ((select public.has_page('fee_reminders')) or (select public.has_page('tutes'))
         or (select public.has_page('post')) or (select public.has_page('class_ops')));
drop policy if exists "class_month_tutes: page read" on public.class_month_tutes;
create policy "class_month_tutes: page read" on public.class_month_tutes for select to authenticated
  using ((select public.has_page('fee_reminders')) or (select public.has_page('class_ops')));

-- -----------------------------------------------------------------------------
-- 2. Classes: save (with mode) and delete
-- -----------------------------------------------------------------------------
drop function if exists public.fee_class_save(uuid, uuid, text, boolean);

create or replace function public.fee_class_save(
  p_id uuid,
  p_batch_id uuid,
  p_name text,
  p_is_active boolean default true,
  p_mode text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  cname text := trim(coalesce(p_name, ''));
  cid uuid := p_id;
  bname text;
begin
  if not (public.has_page('class_ops', true) or public.has_page('fee_reminders', true)) then
    raise exception 'You are not allowed to change classes.' using errcode = '42501';
  end if;
  if p_mode is not null and p_mode not in ('physical', 'online', 'both') then
    raise exception 'Choose Physical, Online or Both.' using errcode = 'P0001';
  end if;
  if char_length(cname) < 2 or char_length(cname) > 120 then
    raise exception 'Class name must be between 2 and 120 characters.' using errcode = 'P0001';
  end if;
  select name into bname from public.batches where id = p_batch_id;
  if bname is null then
    raise exception 'Batch not found.' using errcode = 'P0001';
  end if;

  if cid is null then
    insert into public.fee_classes (batch_id, name, is_active, created_by, mode)
    values (p_batch_id, cname, coalesce(p_is_active, true), actor, coalesce(p_mode, 'both'))
    on conflict (batch_id, lower(name)) do nothing
    returning id into cid;
    if cid is null then
      raise exception 'Class "%" already exists in %.', cname, bname using errcode = 'P0001';
    end if;
    perform public.write_activity('fee.class_added', 'fee_class', cid::text, null,
      'Added class "' || cname || '" under ' || bname,
      jsonb_build_object('batch_id', p_batch_id, 'class_name', cname));
    return cid;
  end if;

  if exists (
    select 1 from public.fee_classes
    where batch_id = p_batch_id and lower(name) = lower(cname) and id <> cid
  ) then
    raise exception 'Class "%" already exists in %.', cname, bname using errcode = 'P0001';
  end if;

  update public.fee_classes
     set batch_id = p_batch_id,
         name = cname,
         is_active = coalesce(p_is_active, true),
         mode = coalesce(p_mode, mode)
   where id = cid;
  if not found then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;

  perform public.write_activity('fee.class_changed', 'fee_class', cid::text, null,
    'Updated class "' || cname || '" (' || bname || ')',
    jsonb_build_object('batch_id', p_batch_id, 'class_name', cname, 'is_active', coalesce(p_is_active, true), 'mode', p_mode));
  return cid;
end;
$$;

revoke all on function public.fee_class_save(uuid, uuid, text, boolean, text) from public, anon;
grant execute on function public.fee_class_save(uuid, uuid, text, boolean, text) to authenticated;

create or replace function public.fee_class_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  if not (public.has_page('class_ops', true) or public.has_page('fee_reminders', true)) then
    raise exception 'You are not allowed to delete classes.' using errcode = '42501';
  end if;
  select fc.id, fc.name, b.name as batch_name into c
    from public.fee_classes fc
    join public.batches b on b.id = fc.batch_id
   where fc.id = p_id;
  if c.id is null then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;
  delete from public.fee_classes where id = p_id;
  perform public.write_activity('fee.class_deleted', 'fee_class', p_id::text, null,
    'Deleted fee tracking class "' || c.name || '" (' || c.batch_name || ')',
    jsonb_build_object('class_name', c.name, 'batch_name', c.batch_name));
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Scheduling tutes: Classes or Fee reminders editors
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
  select cmt.id, cmt.class_id, cmt.month, fc.name as class_name, ct.name as tute_name
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
end;
$$;

create or replace function public.class_month_tute_reorder(
  p_class_id uuid,
  p_month date,
  p_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m date := date_trunc('month', p_month)::date;
  idx integer;
begin
  if not (public.has_page('class_ops', true) or public.has_page('fee_reminders', true)) then
    raise exception 'You are not allowed to manage class tutes.' using errcode = '42501';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    return;
  end if;
  for idx in 1 .. array_length(p_ids, 1) loop
    update public.class_month_tutes
       set sort_order = idx - 1
     where id = p_ids[idx]
       and class_id = p_class_id
       and month = m;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Paid so far: uploaded list or typed count, whichever is newer
-- -----------------------------------------------------------------------------
create or replace function public.fee_month_upload_logged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fee_month_upload_log (class_id, month, student_count, uploaded_at, source, added_by)
  values (new.class_id, new.month, new.unique_student_count, new.uploaded_at, 'upload', (select auth.uid()));
  return null;
end;
$$;

-- Newest paid count for a class and month: the uploaded list (while it is
-- still there) or a typed count, whichever came last.
create or replace function public.class_paid_latest(p_class uuid, p_month date)
returns table (paid integer, at timestamptz, source text)
language sql
stable
security definer
set search_path = ''
as $$
  select x.c, x.at, x.source
  from (
    select i.unique_student_count as c, i.uploaded_at as at, 'upload'::text as source
    from public.fee_month_imports i
    where i.class_id = p_class and i.month = p_month
    union all
    select l.student_count, l.uploaded_at, 'typed'
    from public.fee_month_upload_log l
    where l.class_id = p_class and l.month = p_month and l.source = 'typed'
  ) x
  order by x.at desc
  limit 1;
$$;

create or replace function public.class_paid_count(p_class uuid, p_month date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select l.paid from public.class_paid_latest(p_class, p_month) l;
$$;

revoke all on function public.class_paid_latest(uuid, date) from public, anon, authenticated;
revoke all on function public.class_paid_count(uuid, date) from public, anon, authenticated;

-- Type today's paid count for a class (this month).
create or replace function public.class_paid_count_save(p_class uuid, p_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
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
end;
$$;

revoke all on function public.class_paid_count_save(uuid, integer) from public, anon;
grant execute on function public.class_paid_count_save(uuid, integer) to authenticated;

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
    select public.class_paid_count(p_class, p_month) as c
  ) up;
$$;

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
    select mm.month, public.class_paid_count(p_class, mm.month)::numeric as c
    from (
      select i.month from public.fee_month_imports i where i.class_id = p_class and i.month < p_month
      union
      select l.month from public.fee_month_upload_log l
       where l.class_id = p_class and l.month < p_month and l.source = 'typed'
    ) mm
    order by mm.month desc
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

-- Mid-month pace: learned from every class-month (in the batch) that had at
-- least two counts, uploaded or typed.
create or replace function public.tute_pace_share(p_batch uuid, p_day integer)
returns table (share numeric, samples integer)
language sql
stable
security definer
set search_path = ''
as $$
  with finals as (
    select f.class_id, f.month, f.final
    from (
      select l.class_id, l.month, public.class_paid_count(l.class_id, l.month) as final
      from public.fee_month_upload_log l
      join public.fee_classes fc on fc.id = l.class_id and fc.batch_id = p_batch
      where l.month < date_trunc('month', now() at time zone 'Asia/Colombo')::date
      group by l.class_id, l.month
      having count(*) >= 2
    ) f
    where f.final > 0
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

create or replace function public.tute_paced_expected(p_class uuid, p_month date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.samples >= 4 and s.share >= 0.2 and s.share < 1 then ceil(cur.c / s.share)::integer end
  from (
    select l.paid as c,
           ((l.at at time zone 'Asia/Colombo')::date - p_month) + 1 as day,
           fc.batch_id
    from public.class_paid_latest(p_class, p_month) l
    join public.fee_classes fc on fc.id = p_class
    where p_month = date_trunc('month', now() at time zone 'Asia/Colombo')::date
  ) cur
  cross join lateral public.tute_pace_share(cur.batch_id, cur.day::integer) s;
$$;

-- -----------------------------------------------------------------------------
-- 5. Online / Physical follows the class's mode
-- -----------------------------------------------------------------------------
create or replace function public.class_student_online(p_mode text, p_institute text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_mode = 'online' or (p_mode = 'both' and coalesce(p_institute, '') ilike '%online%');
$$;
revoke all on function public.class_student_online(text, text) from public, anon, authenticated;

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
  select case fc.mode
    when 'online' then 1::numeric
    when 'physical' then 0::numeric
    else coalesce(
      (select avg(case when s.institute ilike '%online%' then 1 else 0 end)::numeric
       from public.fee_month_students s, latest
       where s.class_id = p_class and s.month = latest.month),
      0)
  end
  from public.fee_classes fc
  where fc.id = p_class;
$$;

create or replace function public.post_month_students(p_batch uuid, p_month date)
returns table (
  student_key text, full_name text, classes text, whatsapp text,
  address text, checked boolean, problem text, tutes_due integer, tutes_sent integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  m date := date_trunc('month', p_month)::date;
begin
  if not public.has_page('post') then
    raise exception 'You are not allowed to see postal addresses.' using errcode = '42501';
  end if;
  return query
  with paid as (
    select s.student_key,
           min(s.full_name) as full_name,
           string_agg(distinct fc.name, ', ') as classes,
           max(s.whatsapp_norm) as whatsapp,
           array_agg(distinct s.class_id) as class_ids
    from public.fee_month_students s
    join public.fee_classes fc on fc.id = s.class_id and fc.batch_id = p_batch
    where s.month = m and public.class_student_online(fc.mode, s.institute)
    group by s.student_key
  )
  select
    p.student_key, p.full_name, p.classes, coalesce(a.whatsapp, p.whatsapp),
    a.address, coalesce(a.checked, false), public.post_address_problem(a.address),
    (select count(distinct cmt.tute_id)::integer from public.class_month_tutes cmt
      where cmt.class_id = any (p.class_ids) and cmt.month = m),
    (select count(distinct pi.tute_id)::integer from public.post_parcel_items pi
      where pi.student_key = p.student_key and pi.month = m and pi.active)
  from paid p
  left join public.student_addresses a on a.student_key = p.student_key
  order by lower(p.full_name);
end;
$$;

create or replace function public.post_round_build(p_batch uuid, p_month date, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m date := date_trunc('month', p_month)::date;
  rid uuid;
  pid uuid;
  t record;
  g record;
  shortages text := '';
  n integer := 0;
  parcels integer := 0;
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to build post rounds.' using errcode = '42501';
  end if;
  if p_kind not in ('main', 'top_up') then
    raise exception 'Unknown round type.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.batches where id = p_batch) then
    raise exception 'Batch not found.' using errcode = 'P0001';
  end if;
  -- One build at a time per batch and month.
  perform pg_advisory_xact_lock(hashtext('post-round:' || p_batch || ':' || m));

  create temporary table if not exists pg_temp.post_build (
    student_key text, full_name text, whatsapp text, address text, district text,
    class_id uuid, tute_id uuid
  ) on commit drop;
  truncate pg_temp.post_build;

  insert into pg_temp.post_build
  select distinct on (s.student_key, cmt.tute_id)
    s.student_key, a.full_name, coalesce(a.whatsapp, s.whatsapp_norm), a.address, a.district, s.class_id, cmt.tute_id
  from public.fee_month_students s
  join public.fee_classes fc on fc.id = s.class_id and fc.batch_id = p_batch
  join public.class_month_tutes cmt on cmt.class_id = s.class_id and cmt.month = m
  join public.student_addresses a on a.student_key = s.student_key and a.checked
  where s.month = m and public.class_student_online(fc.mode, s.institute)
    and not exists (select 1 from public.post_parcel_items pi
                    where pi.active and pi.student_key = s.student_key and pi.tute_id = cmt.tute_id and pi.month = m)
  order by s.student_key, cmt.tute_id, s.class_id;

  select count(*) into n from pg_temp.post_build;
  if n = 0 then
    raise exception 'Nobody to post for %: every Online student with a confirmed address already has their tutes.',
      public.month_name(m) using errcode = 'P0001';
  end if;

  -- Enough free copies? Lock the tutes first so two rounds can't take the same copies.
  for t in
    select b.tute_id, ct.name, count(*)::integer as needed
    from pg_temp.post_build b join public.class_tutes ct on ct.id = b.tute_id
    group by b.tute_id, ct.name
    order by b.tute_id
  loop
    perform 1 from public.class_tutes where id = t.tute_id for update;
    if public.tute_available(t.tute_id) < t.needed then
      shortages := shortages || case when shortages = '' then '' else '; ' end
        || t.name || ' needs ' || t.needed || ', ' || greatest(public.tute_available(t.tute_id), 0) || ' free';
    end if;
  end loop;
  if shortages <> '' then
    raise exception 'Not enough stock: %. Print or count first.', shortages using errcode = 'P0001';
  end if;

  insert into public.post_rounds (batch_id, month, kind, created_by)
  values (p_batch, m, p_kind, (select auth.uid()))
  returning id into rid;

  -- One parcel per address (same home → one parcel with everyone's tutes).
  for g in
    select public.post_address_key(b.address) as akey,
           min(b.student_key) as student_key,
           string_agg(distinct b.full_name, ' & ') as full_name,
           max(b.whatsapp) as whatsapp,
           min(b.address) as address,
           max(b.district) as district
    from pg_temp.post_build b
    group by public.post_address_key(b.address)
    order by min(b.full_name)
  loop
    parcels := parcels + 1;
    insert into public.post_parcels (round_id, number, student_key, full_name, whatsapp, address, district)
    values (rid, parcels, g.student_key, left(g.full_name, 300), g.whatsapp, g.address, g.district)
    returning id into pid;
    insert into public.post_parcel_items (parcel_id, tute_id, class_id, student_key, month)
    select pid, b.tute_id, b.class_id, b.student_key, m
    from pg_temp.post_build b
    where public.post_address_key(b.address) = g.akey;
  end loop;

  insert into public.tute_stock_reservations (tute_id, round_id, month, qty)
  select b.tute_id, rid, m, count(*) from pg_temp.post_build b group by b.tute_id;

  perform public.write_activity('post.round_built', 'post_round', rid::text, null,
    case p_kind when 'main' then 'Built the ' else 'Built a top-up ' end || public.month_name(m)
      || ' Speed Post round: ' || parcels || ' parcels, ' || n || ' tutes',
    jsonb_build_object('batch_id', p_batch, 'month', m, 'parcels', parcels, 'tutes', n));
  return rid;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Tute stock reads the same paid count
-- -----------------------------------------------------------------------------
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
                  and public.class_paid_count(s.class_id, s.month) is null), 0) as forecast_error,
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
      public.class_paid_count(fc.id, p_month) as paid
  ) x
  where s.tute_id = p_tute and s.month = p_month;
$$;

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
  select fc.id, fc.name, i.month, f.expected, public.class_paid_count(fc.id, i.month), f.method
  from public.fee_classes fc
  join lateral (
    select mm.month from (
      select x.month from public.fee_month_imports x where x.class_id = fc.id
      union
      select l.month from public.fee_month_upload_log l where l.class_id = fc.id and l.source = 'typed'
    ) mm
    order by mm.month desc
    limit 3
  ) i on true
  cross join lateral public.tute_class_forecast(fc.id, i.month) f
  where (p_batch is null or fc.batch_id = p_batch) and fc.is_active and f.method <> 'none'
  order by fc.name, i.month;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Classes page overview: one row per class for a month
-- -----------------------------------------------------------------------------
create or replace function public.class_ops_overview(p_month date)
returns table (
  class_id uuid, batch_id uuid, batch_name text, name text, mode text, is_active boolean,
  paid integer, paid_at timestamptz, paid_source text, last_month integer, expected integer,
  tutes_this integer, tutes_next integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  m date := date_trunc('month', p_month)::date;
begin
  if not public.has_page('class_ops') then
    raise exception 'You are not allowed to see classes.' using errcode = '42501';
  end if;
  return query
  select
    fc.id, b.id, b.name, fc.name, fc.mode, fc.is_active,
    l.paid, l.at, l.source,
    public.class_paid_count(fc.id, (m - interval '1 month')::date),
    public.tute_expected_students(fc.id, m),
    (select count(*)::integer from public.class_month_tutes s where s.class_id = fc.id and s.month = m),
    (select count(*)::integer from public.class_month_tutes s
      where s.class_id = fc.id and s.month = (m + interval '1 month')::date)
  from public.fee_classes fc
  join public.batches b on b.id = fc.batch_id
  left join lateral public.class_paid_latest(fc.id, m) l on true
  order by b.sort_order, b.name, lower(fc.name);
end;
$$;

revoke all on function public.class_ops_overview(date) from public, anon;
grant execute on function public.class_ops_overview(date) to authenticated;
