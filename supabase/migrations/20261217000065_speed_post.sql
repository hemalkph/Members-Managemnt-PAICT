-- =============================================================================
-- Speed Post dispatch, Phase 3 (docs/TUTE_INVENTORY_PLAN.md). Safe to run more than once.
-- Brand new: nothing from the removed Tute dispatch (migration 045) is reused.
--
--   student_addresses        Private postal addresses of Online students, read from the
--                            monthly paid-list upload. Only the "post" page can read them.
--   post_rounds              A month's main or top-up round: packing → handed over.
--   post_parcels             One parcel per address (brothers and sisters share one), with
--                            a copy of the address at posting time and its tracking number.
--   post_parcel_items        Tute × student × month. A student can never get the same
--                            tute for a month twice, unless the earlier parcel came back.
--   tute_stock_reservations  Copies held for an open round; committed once at handover.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. has_page() learns 'post' (assignable to members)
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
      when p_page = any (array['papers', 'tasks', 'classes', 'notices', 'student_results', 'students', 'fee_reminders', 'tutes', 'post']) then
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

revoke execute on function public.has_page(text, boolean) from public, anon;
grant execute on function public.has_page(text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.student_addresses (
  student_key text primary key check (char_length(student_key) between 2 and 200),
  full_name   text not null check (char_length(trim(full_name)) between 1 and 150),
  whatsapp    text check (whatsapp is null or whatsapp ~ '^[0-9]{9,15}$'),
  address     text not null check (char_length(trim(address)) between 1 and 500),
  -- The address as the LMS last gave it; a change there replaces a staff correction.
  lms_address text not null default '' check (char_length(lms_address) <= 500),
  district    text not null default '' check (char_length(district) <= 100),
  checked     boolean not null default false,
  checked_by  uuid references public.profiles (id) on delete set null,
  checked_at  timestamptz,
  updated_at  timestamptz not null default now()
);

create table if not exists public.post_rounds (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references public.batches (id) on delete restrict,
  month          date not null check (extract(day from month) = 1),
  kind           text not null check (kind in ('main', 'top_up')),
  status         text not null default 'packing' check (status in ('packing', 'handed_over', 'cancelled')),
  receipt_total  numeric(12, 2) check (receipt_total is null or receipt_total between 0 and 100000000),
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  handed_over_by uuid references public.profiles (id) on delete set null,
  handed_over_at timestamptz
);
create index if not exists post_rounds_month_idx on public.post_rounds (batch_id, month, created_at);

create table if not exists public.post_parcels (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.post_rounds (id) on delete cascade,
  number      integer not null check (number between 1 and 100000),
  student_key text not null,
  full_name   text not null,
  whatsapp    text,
  address     text not null,
  district    text not null default '',
  tracking_no text check (tracking_no is null or tracking_no ~ '^[A-Z0-9-]{6,40}$'),
  status      text not null default 'planned'
              check (status in ('planned', 'packed', 'handed_over', 'delivered', 'returned', 'lost', 'void')),
  packed_by   uuid references public.profiles (id) on delete set null,
  packed_at   timestamptz,
  status_at   timestamptz,
  wa_sent_at  timestamptz,
  unique (round_id, number)
);
create unique index if not exists post_parcels_tracking_unique on public.post_parcels (tracking_no) where tracking_no is not null;

create table if not exists public.post_parcel_items (
  id          uuid primary key default gen_random_uuid(),
  parcel_id   uuid not null references public.post_parcels (id) on delete cascade,
  tute_id     uuid not null references public.class_tutes (id) on delete restrict,
  class_id    uuid references public.fee_classes (id) on delete set null,
  student_key text not null,
  month       date not null check (extract(day from month) = 1),
  qty         integer not null default 1 check (qty between 1 and 10),
  -- false once the parcel is voided, returned or lost, so it can be sent again.
  active      boolean not null default true
);
create unique index if not exists post_parcel_items_once on public.post_parcel_items (student_key, tute_id, month) where active;
create index if not exists post_parcel_items_parcel_idx on public.post_parcel_items (parcel_id);

create table if not exists public.tute_stock_reservations (
  id          uuid primary key default gen_random_uuid(),
  tute_id     uuid not null references public.class_tutes (id) on delete restrict,
  round_id    uuid not null references public.post_rounds (id) on delete cascade,
  month       date not null,
  qty         integer not null check (qty >= 0),
  status      text not null default 'active' check (status in ('active', 'committed', 'released')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  unique (round_id, tute_id)
);
create index if not exists tute_stock_reservations_tute_idx on public.tute_stock_reservations (tute_id, status);

-- -----------------------------------------------------------------------------
-- 3. Helpers
-- -----------------------------------------------------------------------------

-- Plain reason an address may not get through ('' when it looks fine).
create or replace function public.post_address_problem(p_address text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_address is null or char_length(trim(p_address)) = 0 then 'No address'
    when char_length(trim(p_address)) < 15 then 'Too short'
    when array_length(regexp_split_to_array(trim(p_address), '\s*[,\n]\s*'), 1) < 2 then 'Needs a town (separate parts with commas)'
    else ''
  end;
$$;

-- Same address written slightly differently → same key (for one parcel per home).
create or replace function public.post_address_key(p_address text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(coalesce(p_address, '')), '[^[:alnum:]]+', '', 'g');
$$;

-- Copies free to reserve: on hand minus copies held for open rounds.
create or replace function public.tute_available(p_tute uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (coalesce((select sum(qty) from public.tute_stock_moves where tute_id = p_tute), 0)
        - coalesce((select sum(qty) from public.tute_stock_reservations where tute_id = p_tute and status = 'active'), 0))::integer;
$$;

-- Posted copies count as given to the class too.
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
                                and mv.month = p_month and mv.kind in ('class_issue', 'post_out')), 0))
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

-- -----------------------------------------------------------------------------
-- 4. Addresses
-- -----------------------------------------------------------------------------

-- Saved from the paid-list upload: [{student_key, full_name, whatsapp, address, district}].
-- The uploader can write but not read addresses.
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
  if not (public.has_page('fee_reminders', true) or public.has_page('post', true)) then
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

-- Staff correct or confirm an address.
create or replace function public.post_address_save(p_student_key text, p_address text, p_checked boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  addr text := left(trim(coalesce(p_address, '')), 500);
  found_key text;
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to change addresses.' using errcode = '42501';
  end if;
  if char_length(addr) < 1 then
    raise exception 'Type the address.' using errcode = 'P0001';
  end if;
  update public.student_addresses
     set address = addr,
         checked = coalesce(p_checked, true),
         checked_by = case when coalesce(p_checked, true) then (select auth.uid()) end,
         checked_at = case when coalesce(p_checked, true) then now() end,
         updated_at = now()
   where student_key = p_student_key
  returning student_key into found_key;
  if found_key is null then
    -- A student whose paid list had no address: add it by hand.
    insert into public.student_addresses (student_key, full_name, whatsapp, address, checked, checked_by, checked_at)
    select s.student_key, s.full_name, s.whatsapp_norm, addr, coalesce(p_checked, true),
           case when coalesce(p_checked, true) then (select auth.uid()) end,
           case when coalesce(p_checked, true) then now() end
    from public.fee_month_students s
    where s.student_key = p_student_key
    order by s.month desc
    limit 1;
    if not found then
      raise exception 'Student not found.' using errcode = 'P0001';
    end if;
  end if;
  perform public.write_activity('post.address_saved', 'student_address', p_student_key, null,
    'Saved a postal address', jsonb_build_object('checked', coalesce(p_checked, true)));
end;
$$;

create or replace function public.post_addresses_confirm(p_keys text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to change addresses.' using errcode = '42501';
  end if;
  update public.student_addresses
     set checked = true, checked_by = (select auth.uid()), checked_at = now()
   where student_key = any (p_keys) and not checked and public.post_address_problem(address) = '';
  get diagnostics n = row_count;
  perform public.write_activity('post.addresses_confirmed', 'student_address', null, null,
    'Confirmed ' || n || ' postal address' || case when n = 1 then '' else 'es' end, '{}'::jsonb);
  return n;
end;
$$;

-- Online students who paid a month in a batch, with their address and post status.
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
    where s.month = m and s.institute ilike '%online%'
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

-- -----------------------------------------------------------------------------
-- 5. Rounds
-- -----------------------------------------------------------------------------

-- Build a round: every Online student who paid the month, has a checked address
-- and still needs that month's tutes. One parcel per address. Reserves the copies.
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
  where s.month = m and s.institute ilike '%online%'
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

create or replace function public.post_parcel_pack(p_parcel uuid, p_packed boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr record;
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to pack parcels.' using errcode = '42501';
  end if;
  select pp.id, pp.status, r.status as round_status into pr
    from public.post_parcels pp join public.post_rounds r on r.id = pp.round_id
   where pp.id = p_parcel
     for update of pp;
  if pr.id is null then
    raise exception 'Parcel not found.' using errcode = 'P0001';
  end if;
  if pr.round_status <> 'packing' or pr.status not in ('planned', 'packed') then
    raise exception 'This parcel can''t be changed any more.' using errcode = 'P0001';
  end if;
  update public.post_parcels
     set status = case when coalesce(p_packed, true) then 'packed' else 'planned' end,
         packed_by = case when coalesce(p_packed, true) then (select auth.uid()) end,
         packed_at = case when coalesce(p_packed, true) then now() end
   where id = p_parcel;
end;
$$;

create or replace function public.post_parcel_set_tracking(p_parcel uuid, p_tracking text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr record;
  code text := nullif(upper(regexp_replace(coalesce(p_tracking, ''), '\s+', '', 'g')), '');
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to change parcels.' using errcode = '42501';
  end if;
  if code is not null and code !~ '^[A-Z0-9-]{6,40}$' then
    raise exception 'That doesn''t look like a tracking number (6–40 letters and digits).' using errcode = 'P0001';
  end if;
  select pp.id, pp.status, r.status as round_status into pr
    from public.post_parcels pp join public.post_rounds r on r.id = pp.round_id
   where pp.id = p_parcel
     for update of pp;
  if pr.id is null then
    raise exception 'Parcel not found.' using errcode = 'P0001';
  end if;
  if pr.round_status <> 'packing' then
    raise exception 'This round is already handed over.' using errcode = 'P0001';
  end if;
  if code is not null and exists (select 1 from public.post_parcels where tracking_no = code and id <> p_parcel) then
    raise exception 'Tracking number % is already on another parcel.', code using errcode = 'P0001';
  end if;
  update public.post_parcels set tracking_no = code where id = p_parcel;
end;
$$;

-- Take a parcel out of an open round (e.g. the student will collect it).
create or replace function public.post_parcel_void(p_parcel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr record;
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to change parcels.' using errcode = '42501';
  end if;
  select pp.id, pp.round_id, pp.status, pp.full_name, r.status as round_status into pr
    from public.post_parcels pp join public.post_rounds r on r.id = pp.round_id
   where pp.id = p_parcel
     for update of pp;
  if pr.id is null then
    raise exception 'Parcel not found.' using errcode = 'P0001';
  end if;
  if pr.round_status <> 'packing' or pr.status not in ('planned', 'packed') then
    raise exception 'Only parcels in a round still being packed can be taken out.' using errcode = 'P0001';
  end if;
  update public.tute_stock_reservations r
     set qty = r.qty - x.n
    from (select tute_id, count(*)::integer as n from public.post_parcel_items
          where parcel_id = p_parcel and active group by tute_id) x
   where r.round_id = pr.round_id and r.tute_id = x.tute_id and r.status = 'active';
  update public.post_parcel_items set active = false where parcel_id = p_parcel;
  update public.post_parcels set status = 'void', status_at = now(), tracking_no = null where id = p_parcel;
  perform public.write_activity('post.parcel_void', 'post_parcel', p_parcel::text, null,
    'Took parcel for ' || pr.full_name || ' out of the round', '{}'::jsonb);
end;
$$;

create or replace function public.post_round_cancel(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rd record;
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to cancel rounds.' using errcode = '42501';
  end if;
  select id, status, month into rd from public.post_rounds where id = p_round for update;
  if rd.id is null then
    raise exception 'Round not found.' using errcode = 'P0001';
  end if;
  if rd.status <> 'packing' then
    raise exception 'Only a round still being packed can be cancelled.' using errcode = 'P0001';
  end if;
  update public.post_parcel_items set active = false
   where parcel_id in (select id from public.post_parcels where round_id = p_round);
  update public.post_parcels set status = 'void', status_at = now(), tracking_no = null
   where round_id = p_round and status in ('planned', 'packed');
  update public.tute_stock_reservations set status = 'released', resolved_at = now()
   where round_id = p_round and status = 'active';
  update public.post_rounds set status = 'cancelled' where id = p_round;
  perform public.write_activity('post.round_cancelled', 'post_round', p_round::text, null,
    'Cancelled a ' || public.month_name(rd.month) || ' Speed Post round', '{}'::jsonb);
end;
$$;

-- At the post office: every parcel packed and tracked. Stock leaves exactly once.
create or replace function public.post_round_handover(p_round uuid, p_receipt_total numeric default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rd record;
  missing integer;
  t record;
  have integer;
  posted integer;
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to hand over rounds.' using errcode = '42501';
  end if;
  select id, status, month into rd from public.post_rounds where id = p_round for update;
  if rd.id is null then
    raise exception 'Round not found.' using errcode = 'P0001';
  end if;
  if rd.status = 'handed_over' then
    -- Pressed twice, or the network retried: nothing more to do.
    return 0;
  end if;
  if rd.status <> 'packing' then
    raise exception 'This round was cancelled.' using errcode = 'P0001';
  end if;
  select count(*) into missing from public.post_parcels
   where round_id = p_round and status <> 'void' and (status <> 'packed' or tracking_no is null);
  if missing > 0 then
    raise exception '% parcel% still need packing or a tracking number.', missing,
      case when missing = 1 then '' else 's' end using errcode = 'P0001';
  end if;

  for t in
    select pi.tute_id, ct.name, pi.class_id, count(*)::integer as n
    from public.post_parcel_items pi
    join public.post_parcels pp on pp.id = pi.parcel_id and pp.round_id = p_round
    join public.class_tutes ct on ct.id = pi.tute_id
    where pi.active
    group by pi.tute_id, ct.name, pi.class_id
    order by pi.tute_id
  loop
    perform 1 from public.class_tutes where id = t.tute_id for update;
    select coalesce(sum(qty), 0) into have from public.tute_stock_moves where tute_id = t.tute_id;
    if have < t.n then
      raise exception 'Only % copies of % on hand. Count the shelf before handing over.', have, t.name
        using errcode = 'P0001';
    end if;
    insert into public.tute_stock_moves (tute_id, qty, kind, class_id, month, ref_id, note, created_by)
    values (t.tute_id, -t.n, 'post_out', t.class_id, rd.month, p_round, 'Speed Post', (select auth.uid()));
  end loop;

  update public.tute_stock_reservations set status = 'committed', resolved_at = now()
   where round_id = p_round and status = 'active';
  update public.post_parcels set status = 'handed_over', status_at = now()
   where round_id = p_round and status = 'packed';
  get diagnostics posted = row_count;
  update public.post_rounds
     set status = 'handed_over', receipt_total = p_receipt_total,
         handed_over_by = (select auth.uid()), handed_over_at = now()
   where id = p_round;
  perform public.write_activity('post.round_handed_over', 'post_round', p_round::text, null,
    'Handed over ' || posted || ' Speed Post parcels (' || public.month_name(rd.month) || ')',
    jsonb_build_object('parcels', posted, 'receipt_total', p_receipt_total));
  perform public.send_tute_stock_alerts();
  return posted;
end;
$$;

-- After posting: delivered, or came back (usable copies back in stock), or lost.
-- Returned and lost parcels free their tutes so the student can be sent them again.
create or replace function public.post_parcel_set_status(p_parcel uuid, p_status text, p_copies_ok boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr record;
  t record;
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to change parcels.' using errcode = '42501';
  end if;
  if p_status not in ('delivered', 'returned', 'lost') then
    raise exception 'Unknown parcel status.' using errcode = 'P0001';
  end if;
  select id, status, full_name, student_key into pr from public.post_parcels where id = p_parcel for update;
  if pr.id is null then
    raise exception 'Parcel not found.' using errcode = 'P0001';
  end if;
  if pr.status not in ('handed_over', 'delivered') then
    raise exception 'Only posted parcels can be marked delivered, returned or lost.' using errcode = 'P0001';
  end if;
  if p_status in ('returned', 'lost') then
    if p_status = 'returned' and coalesce(p_copies_ok, true) then
      for t in
        select tute_id, class_id, month, count(*)::integer as n from public.post_parcel_items
        where parcel_id = p_parcel and active group by tute_id, class_id, month
      loop
        perform 1 from public.class_tutes where id = t.tute_id for update;
        insert into public.tute_stock_moves (tute_id, qty, kind, class_id, month, ref_id, note, created_by)
        values (t.tute_id, t.n, 'return_in', t.class_id, t.month, p_parcel, 'Returned parcel', (select auth.uid()));
      end loop;
    end if;
    update public.post_parcel_items set active = false where parcel_id = p_parcel;
    -- Check the address before sending again.
    update public.student_addresses set checked = false
     where student_key in (select distinct student_key from public.post_parcel_items where parcel_id = p_parcel);
  end if;
  update public.post_parcels set status = p_status, status_at = now() where id = p_parcel;
  perform public.write_activity('post.parcel_' || p_status, 'post_parcel', p_parcel::text, null,
    'Parcel for ' || pr.full_name || ' ' || case p_status when 'delivered' then 'delivered'
      when 'returned' then 'came back' else 'lost' end, '{}'::jsonb);
end;
$$;

create or replace function public.post_parcel_whatsapp_sent(p_parcel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_page('post', true) then
    raise exception 'You are not allowed to change parcels.' using errcode = '42501';
  end if;
  update public.post_parcels set wa_sent_at = now() where id = p_parcel;
end;
$$;

-- Addresses not used for 18 months are removed (monthly job).
create or replace function public.post_addresses_cleanup()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.student_addresses a
   where a.updated_at < now() - interval '18 months'
     and not exists (select 1 from public.post_parcel_items pi
                     join public.post_parcels pp on pp.id = pi.parcel_id
                     join public.post_rounds r on r.id = pp.round_id
                     where pi.student_key = a.student_key and r.created_at > now() - interval '18 months');
  get diagnostics n = row_count;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Row Level Security & Grants
-- -----------------------------------------------------------------------------
alter table public.student_addresses       enable row level security;
alter table public.post_rounds             enable row level security;
alter table public.post_parcels            enable row level security;
alter table public.post_parcel_items       enable row level security;
alter table public.tute_stock_reservations enable row level security;

drop policy if exists "student_addresses: post read" on public.student_addresses;
create policy "student_addresses: post read" on public.student_addresses for select to authenticated
  using ((select public.has_page('post')));
drop policy if exists "post_rounds: post read" on public.post_rounds;
create policy "post_rounds: post read" on public.post_rounds for select to authenticated
  using ((select public.has_page('post')));
drop policy if exists "post_parcels: post read" on public.post_parcels;
create policy "post_parcels: post read" on public.post_parcels for select to authenticated
  using ((select public.has_page('post')));
drop policy if exists "post_parcel_items: post read" on public.post_parcel_items;
create policy "post_parcel_items: post read" on public.post_parcel_items for select to authenticated
  using ((select public.has_page('post')));
drop policy if exists "tute_stock_reservations: page read" on public.tute_stock_reservations;
create policy "tute_stock_reservations: page read" on public.tute_stock_reservations for select to authenticated
  using ((select public.has_page('tutes')) or (select public.has_page('post')));

-- The Speed Post page shows tute and class names.
drop policy if exists "class_tutes: page read" on public.class_tutes;
create policy "class_tutes: page read" on public.class_tutes for select to authenticated
  using ((select public.has_page('fee_reminders')) or (select public.has_page('tutes')) or (select public.has_page('post')));
drop policy if exists "fee_classes: page read" on public.fee_classes;
create policy "fee_classes: page read" on public.fee_classes for select to authenticated
  using ((select public.has_page('fee_reminders')) or (select public.has_page('tutes')) or (select public.has_page('post')));

revoke all on table public.student_addresses, public.post_rounds, public.post_parcels,
  public.post_parcel_items, public.tute_stock_reservations from anon, authenticated;
grant select on table public.student_addresses, public.post_rounds, public.post_parcels,
  public.post_parcel_items, public.tute_stock_reservations to authenticated;

revoke all on function public.tute_available(uuid) from public, anon, authenticated;
revoke all on function public.tute_class_rows(uuid, date) from public, anon, authenticated;
revoke all on function public.post_addresses_cleanup() from public, anon, authenticated;
revoke all on function public.post_address_problem(text) from public, anon;
revoke all on function public.post_address_key(text) from public, anon;
grant execute on function public.post_address_problem(text) to authenticated;
grant execute on function public.post_address_key(text) to authenticated;

revoke all on function public.post_addresses_save(jsonb) from public, anon;
revoke all on function public.post_address_save(text, text, boolean) from public, anon;
revoke all on function public.post_addresses_confirm(text[]) from public, anon;
revoke all on function public.post_month_students(uuid, date) from public, anon;
revoke all on function public.post_round_build(uuid, date, text) from public, anon;
revoke all on function public.post_parcel_pack(uuid, boolean) from public, anon;
revoke all on function public.post_parcel_set_tracking(uuid, text) from public, anon;
revoke all on function public.post_parcel_void(uuid) from public, anon;
revoke all on function public.post_round_cancel(uuid) from public, anon;
revoke all on function public.post_round_handover(uuid, numeric) from public, anon;
revoke all on function public.post_parcel_set_status(uuid, text, boolean) from public, anon;
revoke all on function public.post_parcel_whatsapp_sent(uuid) from public, anon;

grant execute on function public.post_addresses_save(jsonb) to authenticated;
grant execute on function public.post_address_save(text, text, boolean) to authenticated;
grant execute on function public.post_addresses_confirm(text[]) to authenticated;
grant execute on function public.post_month_students(uuid, date) to authenticated;
grant execute on function public.post_round_build(uuid, date, text) to authenticated;
grant execute on function public.post_parcel_pack(uuid, boolean) to authenticated;
grant execute on function public.post_parcel_set_tracking(uuid, text) to authenticated;
grant execute on function public.post_parcel_void(uuid) to authenticated;
grant execute on function public.post_round_cancel(uuid) to authenticated;
grant execute on function public.post_round_handover(uuid, numeric) to authenticated;
grant execute on function public.post_parcel_set_status(uuid, text, boolean) to authenticated;
grant execute on function public.post_parcel_whatsapp_sent(uuid) to authenticated;

-- 1st of every month, 9:30 Sri Lanka time (scheduling the same name again replaces it)
select cron.schedule('post-addresses-cleanup', '0 4 1 * *', $$ select public.post_addresses_cleanup(); $$);
