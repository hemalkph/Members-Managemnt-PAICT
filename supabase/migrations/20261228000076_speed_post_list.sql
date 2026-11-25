-- =============================================================================
-- Speed Post gets its own upload, apart from the Fee reminders paid list.
-- Safe to run more than once.
--
--   post_month_lists     One uploaded Speed Post list per class and month (file name, who, when).
--   post_list_students   The students on that list. Everyone on it gets that class's tutes for
--                        the month by post; the Institute column and class mode no longer decide.
--
-- Fee reminders no longer saves postal addresses: only the Speed Post upload does.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.post_month_lists (
  class_id    uuid not null references public.fee_classes (id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  file_name   text not null default '' check (char_length(file_name) <= 200),
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  primary key (class_id, month)
);

create table if not exists public.post_list_students (
  class_id    uuid not null,
  month       date not null,
  student_key text not null check (char_length(student_key) between 2 and 200),
  full_name   text not null check (char_length(trim(full_name)) between 1 and 150),
  whatsapp    text check (whatsapp is null or whatsapp ~ '^[0-9]{9,15}$'),
  primary key (class_id, month, student_key),
  foreign key (class_id, month) references public.post_month_lists (class_id, month) on delete cascade
);

create index if not exists post_list_students_month_idx on public.post_list_students (month, student_key);

-- Private like the addresses: only the Speed Post functions below read them.
alter table public.post_month_lists   enable row level security;
alter table public.post_list_students enable row level security;
revoke all on table public.post_month_lists, public.post_list_students from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Addresses are saved only from Speed Post (no longer from Fee reminders)
-- -----------------------------------------------------------------------------
create or replace function public.post_addresses_save(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  addr text;
  saved integer := 0;
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to save addresses.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Save at most 5,000 addresses at once.' using errcode = 'P0001';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    addr := left(trim(coalesce(r ->> 'address', '')), 500);
    continue when addr = '' or char_length(trim(coalesce(r ->> 'student_key', ''))) < 2;
    insert into public.student_addresses as a (student_key, full_name, whatsapp, address, lms_address, district, updated_at)
    values (
      left(trim(r ->> 'student_key'), 200),
      left(coalesce(nullif(trim(r ->> 'full_name'), ''), '?'), 150),
      case when coalesce(r ->> 'whatsapp', '') ~ '^[0-9]{9,15}$' then r ->> 'whatsapp' end,
      addr, addr,
      left(trim(coalesce(r ->> 'district', '')), 100),
      now())
    on conflict (student_key) do update set
      full_name   = excluded.full_name,
      whatsapp    = coalesce(excluded.whatsapp, a.whatsapp),
      district    = case when excluded.district <> '' then excluded.district else a.district end,
      address     = case when a.lms_address is distinct from excluded.lms_address then excluded.address else a.address end,
      checked     = case when a.lms_address is distinct from excluded.lms_address then false else a.checked end,
      lms_address = excluded.lms_address,
      updated_at  = now();
    saved := saved + 1;
  end loop;
  return saved;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Upload, delete and list the Speed Post lists
-- -----------------------------------------------------------------------------
-- Replaces the class's list for the month and saves the addresses on it.
-- Rows: [{student_key, full_name, whatsapp, address, district}]. Returns the student count.
create or replace function public.post_list_replace(p_class uuid, p_month date, p_file_name text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  m date := date_trunc('month', p_month)::date;
  c record;
  n integer;
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to upload Speed Post lists.' using errcode = '42501';
  end if;
  if m is null then
    raise exception 'Choose a month.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then
    raise exception 'The list needs 1 to 5,000 students.' using errcode = 'P0001';
  end if;
  select id, name into c from public.fee_classes where id = p_class;
  if c.id is null then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;

  insert into public.post_month_lists as l (class_id, month, file_name, uploaded_by, uploaded_at)
  values (p_class, m, left(coalesce(trim(p_file_name), ''), 200), (select auth.uid()), now())
  on conflict (class_id, month) do update set
    file_name = excluded.file_name, uploaded_by = excluded.uploaded_by, uploaded_at = excluded.uploaded_at;

  delete from public.post_list_students where class_id = p_class and month = m;
  insert into public.post_list_students (class_id, month, student_key, full_name, whatsapp)
  select distinct on (k) p_class, m, k,
         left(coalesce(nullif(trim(r ->> 'full_name'), ''), '?'), 150),
         case when coalesce(r ->> 'whatsapp', '') ~ '^[0-9]{9,15}$' then r ->> 'whatsapp' end
  from (select value as r, left(trim(coalesce(value ->> 'student_key', '')), 200) as k
        from jsonb_array_elements(p_rows)) x
  where char_length(k) >= 2
  order by k;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'No students with a name and contact on this list.' using errcode = 'P0001';
  end if;

  perform public.post_addresses_save(p_rows);

  perform public.write_activity('post.list_uploaded', 'fee_class', p_class::text, null,
    'Uploaded the ' || public.month_name(m) || ' Speed Post list for ' || c.name || ': ' || n || ' students',
    jsonb_build_object('class_id', p_class, 'month', m, 'students', n));
  return n;
end;
$$;

create or replace function public.post_list_delete(p_class uuid, p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m date := date_trunc('month', p_month)::date;
  cname text;
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to delete Speed Post lists.' using errcode = '42501';
  end if;
  delete from public.post_month_lists where class_id = p_class and month = m;
  if found then
    select name into cname from public.fee_classes where id = p_class;
    perform public.write_activity('post.list_deleted', 'fee_class', p_class::text, null,
      'Deleted the ' || public.month_name(m) || ' Speed Post list for ' || coalesce(cname, '?'),
      jsonb_build_object('class_id', p_class, 'month', m));
  end if;
end;
$$;

-- The batch's lists for a month: one row per class (lists not uploaded yet have no file).
create or replace function public.post_lists(p_batch uuid, p_month date)
returns table (
  class_id uuid, class_name text, is_active boolean, file_name text, uploaded_at timestamptz,
  students integer, with_address integer
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
    raise exception 'You are not allowed to see Speed Post lists.' using errcode = '42501';
  end if;
  return query
  select fc.id, fc.name, fc.is_active, l.file_name, l.uploaded_at,
    (select count(*)::integer from public.post_list_students s where s.class_id = fc.id and s.month = m),
    (select count(*)::integer from public.post_list_students s
       join public.student_addresses a on a.student_key = s.student_key
      where s.class_id = fc.id and s.month = m)
  from public.fee_classes fc
  left join public.post_month_lists l on l.class_id = fc.id and l.month = m
  where fc.batch_id = p_batch and (fc.is_active or l.class_id is not null)
  order by lower(fc.name);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Who gets posted comes from the Speed Post list
-- -----------------------------------------------------------------------------
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
  with listed as (
    select s.student_key,
           min(s.full_name) as full_name,
           string_agg(distinct fc.name, ', ') as classes,
           max(s.whatsapp) as whatsapp,
           array_agg(distinct s.class_id) as class_ids
    from public.post_list_students s
    join public.fee_classes fc on fc.id = s.class_id and fc.batch_id = p_batch
    where s.month = m
    group by s.student_key
  )
  select
    p.student_key, p.full_name, p.classes, coalesce(a.whatsapp, p.whatsapp),
    a.address, coalesce(a.checked, false), public.post_address_problem(a.address),
    (select count(distinct cmt.tute_id)::integer from public.class_month_tutes cmt
      where cmt.class_id = any (p.class_ids) and cmt.month = m),
    (select count(distinct pi.tute_id)::integer from public.post_parcel_items pi
      where pi.student_key = p.student_key and pi.month = m and pi.active)
  from listed p
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
    s.student_key, a.full_name, coalesce(a.whatsapp, s.whatsapp), a.address, a.district, s.class_id, cmt.tute_id
  from public.post_list_students s
  join public.fee_classes fc on fc.id = s.class_id and fc.batch_id = p_batch
  join public.class_month_tutes cmt on cmt.class_id = s.class_id and cmt.month = m
  join public.student_addresses a on a.student_key = s.student_key and a.checked
  where s.month = m
    and not exists (select 1 from public.post_parcel_items pi
                    where pi.active and pi.student_key = s.student_key and pi.tute_id = cmt.tute_id and pi.month = m)
  order by s.student_key, cmt.tute_id, s.class_id;

  select count(*) into n from pg_temp.post_build;
  if n = 0 then
    raise exception 'Nobody to post for %: everyone on the Speed Post list with a confirmed address already has their tutes.',
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
-- 5. Tute stock's Online / Hall split follows the latest Speed Post list
--    (its size against that month's paid count); classes without a list keep the mode.
-- -----------------------------------------------------------------------------
create or replace function public.tute_online_share(p_class uuid, p_month date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with post as (
    select max(month) as month from public.post_month_lists where class_id = p_class and month <= p_month
  ), latest as (
    select max(month) as month from public.fee_month_students where class_id = p_class and month <= p_month
  )
  select case
    when post.month is not null then (
      select least(1::numeric, x.n::numeric / greatest(coalesce(public.class_paid_count(p_class, post.month), x.n), 1))
      from (select count(*)::integer as n from public.post_list_students s
            where s.class_id = p_class and s.month = post.month) x)
    when fc.mode = 'online' then 1::numeric
    when fc.mode = 'physical' then 0::numeric
    else coalesce(
      (select avg(case when s.institute ilike '%online%' then 1 else 0 end)::numeric
       from public.fee_month_students s, latest
       where s.class_id = p_class and s.month = latest.month),
      0)
  end
  from public.fee_classes fc, post
  where fc.id = p_class;
$$;

-- -----------------------------------------------------------------------------
-- 6. Old lists go with old addresses (18 months)
-- -----------------------------------------------------------------------------
create or replace function public.post_addresses_cleanup()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.post_month_lists where month < (now() - interval '18 months')::date;
  delete from public.student_addresses a
   where a.updated_at < now() - interval '18 months'
     and not exists (select 1 from public.post_parcel_items pi
                     join public.post_parcels pp on pp.id = pi.parcel_id
                     join public.post_rounds r on r.id = pp.round_id
                     where pi.student_key = a.student_key and r.created_at > now() - interval '18 months')
     and not exists (select 1 from public.post_list_students s where s.student_key = a.student_key);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Grants
-- -----------------------------------------------------------------------------
revoke all on function public.post_list_replace(uuid, date, text, jsonb) from public, anon;
revoke all on function public.post_list_delete(uuid, date) from public, anon;
revoke all on function public.post_lists(uuid, date) from public, anon;
grant execute on function public.post_list_replace(uuid, date, text, jsonb) to authenticated;
grant execute on function public.post_list_delete(uuid, date) to authenticated;
grant execute on function public.post_lists(uuid, date) to authenticated;
