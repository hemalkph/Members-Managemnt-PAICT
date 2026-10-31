-- =============================================================================
-- Tute dispatch, Phase 2: rounds, manifests, references, tracking numbers and
-- courier files. Safe to run more than once.
--
-- A round is planned as a draft (tutes, students, contents, COD), then
-- finalised: every chosen student gets a parcel with a fixed reference and a
-- frozen copy of the address, contents and COD. Tracking numbers come only
-- from Citypak files. Personal data lives only in parcel_recipients.
-- Every write goes through the functions below (checked with has_dispatch).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.dispatch_rounds (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(trim(name)) between 2 and 120),
  batch_id         uuid not null references public.batches (id) on delete restrict,
  sending_month    date not null check (extract(day from sending_month) = 1),
  group_label      text not null default '' check (char_length(group_label) <= 60),
  subject          text not null default '' check (char_length(subject) <= 60),
  ref_prefix       text not null check (ref_prefix ~ '^[A-Z0-9]{2,20}$'),
  default_cod      numeric(12, 2) not null default 0 check (default_cod >= 0 and default_cod <= 1000000),
  default_weight_g integer not null default 1000 check (default_weight_g between 1 and 30000),
  default_pieces   integer not null default 1 check (default_pieces between 1 and 20),
  planned_handover date,
  notes            text not null default '' check (char_length(notes) <= 500),
  state            text not null default 'draft' check (state in ('draft', 'finalised', 'active', 'closed', 'cancelled')),
  manifest_version integer not null default 0,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  finalised_by     uuid references public.profiles (id) on delete set null,
  finalised_at     timestamptz,
  closed_by        uuid references public.profiles (id) on delete set null,
  closed_at        timestamptz,
  close_note       text check (char_length(close_note) <= 500)
);
create index if not exists dispatch_rounds_state_idx on public.dispatch_rounds (state, created_at desc);
create index if not exists dispatch_rounds_batch_idx on public.dispatch_rounds (batch_id);

create table if not exists public.round_tutes (
  id             uuid primary key default gen_random_uuid(),
  round_id       uuid not null references public.dispatch_rounds (id) on delete cascade,
  paper_id       uuid references public.papers (id) on delete set null,
  manual_title   text check (char_length(manual_title) <= 150),
  title          text not null check (char_length(trim(title)) between 1 and 150),
  short_code     text not null check (short_code ~ '^[A-Z0-9-]{1,10}$'),
  version_label  text not null default '' check (char_length(version_label) <= 30),
  qty_per_parcel integer not null default 1 check (qty_per_parcel between 1 and 10),
  sort_order     integer not null default 0,
  check (paper_id is not null or manual_title is not null)
);
create unique index if not exists round_tutes_code_unique on public.round_tutes (round_id, short_code);

-- Draft plan: who is in the round, their COD, and which tutes they don't get.
create table if not exists public.round_students (
  round_id          uuid not null references public.dispatch_rounds (id) on delete cascade,
  student_id        uuid not null references public.students (id) on delete restrict,
  cod_amount        numeric(12, 2) check (cod_amount >= 0 and cod_amount <= 1000000),
  note              text not null default '' check (char_length(note) <= 300),
  excluded_tute_ids uuid[] not null default '{}',
  primary key (round_id, student_id)
);
create index if not exists round_students_student_idx on public.round_students (student_id);

-- Parcels hold no personal data (see parcel_recipients).
create table if not exists public.parcels (
  id                 uuid primary key default gen_random_uuid(),
  round_id           uuid not null references public.dispatch_rounds (id) on delete restrict,
  student_id         uuid not null references public.students (id) on delete restrict,
  reference          text not null check (reference ~ '^[A-Z0-9]{2,40}$'),
  tracking_no        text check (tracking_no ~ '^[A-Z0-9]{4,30}$'),
  replaces_parcel_id uuid references public.parcels (id) on delete restrict,
  registration_state text not null default 'unregistered' check (registration_state in ('unregistered', 'registered', 'voided')),
  pack_state         text not null default 'planned' check (pack_state in ('planned', 'packed', 'verified')),
  delivery_state     text not null default 'awaiting_pickup'
                     check (delivery_state in ('awaiting_pickup', 'handed_over', 'in_transit', 'delivered', 'failed', 'returned')),
  on_hold            boolean not null default false,
  cod_expected       numeric(12, 2) not null check (cod_expected >= 0 and cod_expected <= 1000000),
  weight_g           integer not null check (weight_g between 1 and 30000),
  pieces             integer not null check (pieces between 1 and 20),
  assigned_to        uuid references public.profiles (id) on delete set null,
  packed_by          uuid references public.profiles (id) on delete set null,
  packed_at          timestamptz,
  verified_by        uuid references public.profiles (id) on delete set null,
  verified_at        timestamptz,
  manifest_version   integer not null default 1,
  row_version        integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- References are unique across all rounds forever (voided ones included).
create unique index if not exists parcels_reference_unique on public.parcels (reference);
create unique index if not exists parcels_tracking_unique on public.parcels (tracking_no) where tracking_no is not null;
create unique index if not exists parcels_round_student_unique on public.parcels (round_id, student_id) where registration_state <> 'voided';
create index if not exists parcels_round_pack_idx on public.parcels (round_id, pack_state);
create index if not exists parcels_round_delivery_idx on public.parcels (round_id, delivery_state);
create index if not exists parcels_assigned_idx on public.parcels (assigned_to) where assigned_to is not null;

-- The address copied at finalise (personal data; plan and courier only).
create table if not exists public.parcel_recipients (
  parcel_id     uuid primary key references public.parcels (id) on delete cascade,
  name          text not null check (char_length(name) <= 120),
  address_line1 text not null default '' check (char_length(address_line1) <= 200),
  address_line2 text not null default '' check (char_length(address_line2) <= 200),
  address_line3 text not null default '' check (char_length(address_line3) <= 200),
  city          text not null default '' check (char_length(city) <= 60),
  phone1        text check (phone1 ~ '^0[0-9]{9}$'),
  phone2        text check (phone2 ~ '^0[0-9]{9}$'),
  anonymised_at timestamptz
);

create table if not exists public.parcel_items (
  parcel_id     uuid not null references public.parcels (id) on delete cascade,
  round_tute_id uuid not null references public.round_tutes (id) on delete restrict,
  qty           integer not null check (qty between 1 and 10),
  primary key (parcel_id, round_tute_id)
);

-- Append-only history. Details hold ids and states only, never addresses.
create table if not exists public.parcel_events (
  id         bigint generated always as identity primary key,
  parcel_id  uuid not null references public.parcels (id) on delete cascade,
  round_id   uuid not null references public.dispatch_rounds (id) on delete cascade,
  type       text not null check (char_length(type) between 3 and 40),
  from_state text,
  to_state   text,
  actor      uuid references public.profiles (id) on delete set null,
  source     text not null check (source in ('manual', 'import', 'system', 'scan')),
  reason     text check (char_length(reason) <= 300),
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists parcel_events_parcel_idx on public.parcel_events (parcel_id, created_at);

create or replace function public.parcel_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Parcel history cannot be changed or deleted.' using errcode = '42501';
end;
$$;

create or replace trigger parcel_events_no_update
  before update or delete on public.parcel_events
  for each row execute function public.parcel_events_append_only();

create table if not exists public.carrier_files (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid references public.dispatch_rounds (id) on delete restrict,
  kind         text not null check (kind in ('citypak_template', 'manifest_export', 'tracking_sheet', 'waybill_pdf',
                                             'status_report', 'settlement_report')),
  storage_path text not null check (storage_path ~ '^(rounds/[0-9a-f-]{36}|templates)/[0-9a-f-]{36}\.(xlsx|csv|pdf)$'),
  file_name    text not null check (char_length(file_name) between 1 and 200),
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes   integer not null check (size_bytes between 1 and 15728640),
  row_count    integer,
  summary      jsonb not null default '{}'::jsonb,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create unique index if not exists carrier_files_same_file
  on public.carrier_files (coalesce(round_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, sha256);
create index if not exists carrier_files_round_idx on public.carrier_files (round_id, created_at desc);

-- Export stays switched off until a main admin stores a verified blank template.
alter table public.dispatch_settings add column if not exists citypak_template_file uuid references public.carrier_files (id) on delete set null;
alter table public.dispatch_settings add column if not exists citypak_template_verified boolean not null default false;
alter table public.dispatch_settings add column if not exists citypak_template_verified_by uuid references public.profiles (id) on delete set null;
alter table public.dispatch_settings add column if not exists citypak_template_verified_at timestamptz;

-- -----------------------------------------------------------------------------
-- 2. Helpers
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_require(p_cap text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_dispatch(p_cap) then
    raise exception 'You are not allowed to do this in Tute dispatch.' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;

-- A draft round, locked for this transaction.
create or replace function public.dispatch_lock_draft(p_round uuid)
returns public.dispatch_rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.dispatch_rounds;
begin
  select * into r from public.dispatch_rounds where id = p_round for update;
  if r.id is null then
    raise exception 'Round not found.' using errcode = 'P0001';
  end if;
  if r.state <> 'draft' then
    raise exception 'This round is finalised; its plan can no longer be edited.' using errcode = 'P0001';
  end if;
  return r;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Planning (draft only, plan capability)
-- -----------------------------------------------------------------------------
create or replace function public.round_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
  rid uuid := nullif(p ->> 'id', '')::uuid;
  r public.dispatch_rounds;
begin
  if rid is null then
    insert into public.dispatch_rounds (name, batch_id, sending_month, group_label, subject, ref_prefix, default_cod,
                                        default_weight_g, default_pieces, planned_handover, notes, created_by, updated_by)
    values (trim(p ->> 'name'), (p ->> 'batch_id')::uuid, date_trunc('month', (p ->> 'sending_month')::date)::date,
            coalesce(trim(p ->> 'group_label'), ''), coalesce(trim(p ->> 'subject'), ''), upper(trim(p ->> 'ref_prefix')),
            coalesce((p ->> 'default_cod')::numeric, 0), coalesce((p ->> 'default_weight_g')::integer, 1000),
            coalesce((p ->> 'default_pieces')::integer, 1), nullif(p ->> 'planned_handover', '')::date,
            coalesce(trim(p ->> 'notes'), ''), actor, actor)
    returning id into rid;
    perform public.write_activity('dispatch.round_created', 'dispatch', rid::text, null,
      'Created dispatch round ' || trim(p ->> 'name'), jsonb_build_object('round_id', rid));
    return rid;
  end if;

  r := public.dispatch_lock_draft(rid);
  -- The batch can't change once students are chosen.
  if (p ->> 'batch_id')::uuid is distinct from r.batch_id
     and exists (select 1 from public.round_students where round_id = rid) then
    raise exception 'Remove the chosen students before changing the batch.' using errcode = 'P0001';
  end if;
  update public.dispatch_rounds set
    name             = trim(p ->> 'name'),
    batch_id         = (p ->> 'batch_id')::uuid,
    sending_month    = date_trunc('month', (p ->> 'sending_month')::date)::date,
    group_label      = coalesce(trim(p ->> 'group_label'), ''),
    subject          = coalesce(trim(p ->> 'subject'), ''),
    ref_prefix       = upper(trim(p ->> 'ref_prefix')),
    default_cod      = coalesce((p ->> 'default_cod')::numeric, 0),
    default_weight_g = coalesce((p ->> 'default_weight_g')::integer, 1000),
    default_pieces   = coalesce((p ->> 'default_pieces')::integer, 1),
    planned_handover = nullif(p ->> 'planned_handover', '')::date,
    notes            = coalesce(trim(p ->> 'notes'), ''),
    updated_by       = actor,
    updated_at       = now()
  where id = rid;
  return rid;
end;
$$;

-- Replace the round's tutes. Each: {id?, paper_id? | manual_title?, short_code, version_label, qty_per_parcel}.
-- Only finished tutes (kind tute, status done) can be picked from Papers.
create or replace function public.round_set_tutes(p_round uuid, p_tutes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
  t jsonb;
  pid uuid;
  ptitle text;
  keep uuid[] := '{}';
  tid uuid;
  i integer := 0;
begin
  perform public.dispatch_lock_draft(p_round);
  if jsonb_typeof(p_tutes) <> 'array' or jsonb_array_length(p_tutes) > 30 then
    raise exception 'Choose at most 30 tutes.' using errcode = 'P0001';
  end if;

  for t in select value from jsonb_array_elements(p_tutes) loop
    i := i + 1;
    pid := nullif(t ->> 'paper_id', '')::uuid;
    ptitle := null;
    if pid is not null then
      select title into ptitle from public.papers where id = pid and kind = 'tute' and status = 'done';
      if ptitle is null then
        raise exception 'Only finished tutes can be dispatched.' using errcode = 'P0001';
      end if;
    elsif nullif(trim(t ->> 'manual_title'), '') is null then
      raise exception 'Give each tute a title.' using errcode = 'P0001';
    end if;

    tid := nullif(t ->> 'id', '')::uuid;
    if tid is not null and exists (select 1 from public.round_tutes where id = tid and round_id = p_round) then
      update public.round_tutes set
        paper_id = pid,
        manual_title = case when pid is null then trim(t ->> 'manual_title') end,
        title = coalesce(ptitle, trim(t ->> 'manual_title')),
        short_code = upper(trim(t ->> 'short_code')),
        version_label = coalesce(trim(t ->> 'version_label'), ''),
        qty_per_parcel = coalesce((t ->> 'qty_per_parcel')::integer, 1),
        sort_order = i
      where id = tid and round_id = p_round;
    else
      insert into public.round_tutes (round_id, paper_id, manual_title, title, short_code, version_label, qty_per_parcel, sort_order)
      values (p_round, pid, case when pid is null then trim(t ->> 'manual_title') end,
              coalesce(ptitle, trim(t ->> 'manual_title')), upper(trim(t ->> 'short_code')),
              coalesce(trim(t ->> 'version_label'), ''), coalesce((t ->> 'qty_per_parcel')::integer, 1), i)
      returning id into tid;
    end if;
    keep := keep || tid;
  end loop;

  delete from public.round_tutes where round_id = p_round and not (id = any (keep));
  -- Forget exclusions of tutes that are gone.
  update public.round_students
     set excluded_tute_ids = array(select x from unnest(excluded_tute_ids) as x where x = any (keep))
   where round_id = p_round and not (excluded_tute_ids <@ keep);
  update public.dispatch_rounds set updated_by = actor, updated_at = now() where id = p_round;
end;
$$;

-- Replace who is in the round. Each: {student_id, cod_amount?, note?, excluded_tute_ids?}.
create or replace function public.round_set_students(p_round uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
  r public.dispatch_rounds;
  row_ jsonb;
  n integer := 0;
  sid uuid;
  excluded uuid[];
begin
  r := public.dispatch_lock_draft(p_round);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then
    raise exception 'Choose at most 3,000 students.' using errcode = 'P0001';
  end if;

  delete from public.round_students where round_id = p_round;
  for row_ in select value from jsonb_array_elements(p_rows) loop
    sid := (row_ ->> 'student_id')::uuid;
    if not exists (select 1 from public.students
                   where id = sid and batch_id = r.batch_id and is_active and anonymised_at is null) then
      raise exception 'Only active students of this round''s batch can be chosen.' using errcode = 'P0001';
    end if;
    excluded := coalesce(array(select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(row_ -> 'excluded_tute_ids', '[]'::jsonb)) as x), '{}');
    if exists (select 1 from unnest(excluded) e where not exists (select 1 from public.round_tutes where id = e and round_id = p_round)) then
      raise exception 'Unknown tute in the contents.' using errcode = 'P0001';
    end if;
    insert into public.round_students (round_id, student_id, cod_amount, note, excluded_tute_ids)
    values (p_round, sid, nullif(row_ ->> 'cod_amount', '')::numeric, coalesce(trim(row_ ->> 'note'), ''), excluded);
    n := n + 1;
  end loop;
  update public.dispatch_rounds set updated_by = actor, updated_at = now() where id = p_round;
  return n;
end;
$$;

create or replace function public.round_cancel(p_round uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
  r public.dispatch_rounds;
begin
  r := public.dispatch_lock_draft(p_round);
  update public.dispatch_rounds
     set state = 'cancelled', close_note = left(coalesce(p_reason, ''), 500), closed_by = actor, closed_at = now(),
         updated_by = actor, updated_at = now()
   where id = p_round;
  perform public.write_activity('dispatch.round_cancelled', 'dispatch', p_round::text, null,
    'Cancelled draft round ' || r.name, jsonb_build_object('round_id', p_round));
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Finalise: freeze the plan into parcels with fixed references
-- -----------------------------------------------------------------------------
create or replace function public.round_finalise(p_round uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
  r public.dispatch_rounds;
  rs record;
  pid uuid;
  n integer := 0;
  problem text;
begin
  r := public.dispatch_lock_draft(p_round);

  if not exists (select 1 from public.round_tutes where round_id = p_round) then
    raise exception 'Add at least one tute.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.round_students where round_id = p_round) then
    raise exception 'Choose at least one student.' using errcode = 'P0001';
  end if;

  -- Blocking checks, reported with the student number.
  select s.student_no || ': ' ||
         case
           when not s.is_active or s.anonymised_at is not null then 'not an active student'
           when trim(s.address_line1) = '' or trim(s.city) = '' then 'address or city missing'
           when s.phone1 is null then 'phone missing'
           when not exists (select 1 from public.round_tutes t where t.round_id = p_round and not (t.id = any (rs2.excluded_tute_ids)))
             then 'no tutes in the parcel'
           when exists (select 1 from public.parcels p where p.reference = r.ref_prefix || s.student_no)
             then 'reference ' || r.ref_prefix || s.student_no || ' is already used'
           when char_length(r.ref_prefix || s.student_no) > 40 then 'reference too long'
           when s.student_no !~ '^[0-9A-Z]+$' then 'student number has characters a reference can''t use'
         end
    into problem
    from public.round_students rs2 join public.students s on s.id = rs2.student_id
   where rs2.round_id = p_round
     and (not s.is_active or s.anonymised_at is not null
          or trim(s.address_line1) = '' or trim(s.city) = '' or s.phone1 is null
          or not exists (select 1 from public.round_tutes t where t.round_id = p_round and not (t.id = any (rs2.excluded_tute_ids)))
          or exists (select 1 from public.parcels p where p.reference = r.ref_prefix || s.student_no)
          or char_length(r.ref_prefix || s.student_no) > 40
          or s.student_no !~ '^[0-9A-Z]+$')
   order by s.student_no
   limit 1;
  if problem is not null then
    raise exception 'Can''t finalise – %', problem using errcode = 'P0001';
  end if;

  for rs in
    select rs2.*, s.student_no, s.full_name, s.address_line1, s.address_line2, s.address_line3, s.city, s.phone1, s.phone2
      from public.round_students rs2 join public.students s on s.id = rs2.student_id
     where rs2.round_id = p_round
     order by s.student_no
  loop
    insert into public.parcels (round_id, student_id, reference, cod_expected, weight_g, pieces, manifest_version)
    values (p_round, rs.student_id, r.ref_prefix || rs.student_no, coalesce(rs.cod_amount, r.default_cod),
            r.default_weight_g, r.default_pieces, 1)
    returning id into pid;

    insert into public.parcel_recipients (parcel_id, name, address_line1, address_line2, address_line3, city, phone1, phone2)
    values (pid, rs.full_name, rs.address_line1, rs.address_line2, rs.address_line3, rs.city, rs.phone1, rs.phone2);

    insert into public.parcel_items (parcel_id, round_tute_id, qty)
    select pid, t.id, t.qty_per_parcel from public.round_tutes t
     where t.round_id = p_round and not (t.id = any (rs.excluded_tute_ids));

    insert into public.parcel_events (parcel_id, round_id, type, to_state, actor, source)
    values (pid, p_round, 'created', 'unregistered', actor, 'system');
    n := n + 1;
  end loop;

  update public.dispatch_rounds
     set state = 'finalised', manifest_version = 1, finalised_by = actor, finalised_at = now(),
         updated_by = actor, updated_at = now()
   where id = p_round;

  perform public.write_activity('dispatch.round_finalised', 'dispatch', p_round::text, null,
    'Finalised dispatch round ' || r.name || ' with ' || n || ' parcels', jsonb_build_object('round_id', p_round, 'parcels', n));
  return n;
end;
$$;

-- Fix a parcel before it is registered with the courier (address, COD or contents).
-- p: {cod_expected?, recipient?: {...}, tute_ids?: [round_tute_id...]}. A reason is required.
-- After registration the label already shows the details, so the parcel must be voided instead (Phase 4).
create or replace function public.parcel_correct(p_parcel uuid, p jsonb, p_reason text, p_row_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
  par public.parcels;
  tids uuid[];
begin
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for the correction.' using errcode = 'P0001';
  end if;
  select * into par from public.parcels where id = p_parcel for update;
  if par.id is null then
    raise exception 'Parcel not found.' using errcode = 'P0001';
  end if;
  if par.registration_state <> 'unregistered' then
    raise exception 'This parcel is already registered with the courier. It must be voided and replaced instead.' using errcode = 'P0001';
  end if;
  if par.row_version <> p_row_version then
    raise exception 'This parcel was changed by someone else. Reload and try again.' using errcode = 'P0001';
  end if;

  if p ? 'cod_expected' then
    update public.parcels set cod_expected = (p ->> 'cod_expected')::numeric where id = p_parcel;
  end if;
  if p ? 'recipient' then
    update public.parcel_recipients set
      name          = trim(p #>> '{recipient,name}'),
      address_line1 = coalesce(trim(p #>> '{recipient,address_line1}'), ''),
      address_line2 = coalesce(trim(p #>> '{recipient,address_line2}'), ''),
      address_line3 = coalesce(trim(p #>> '{recipient,address_line3}'), ''),
      city          = coalesce(trim(p #>> '{recipient,city}'), ''),
      phone1        = nullif(trim(p #>> '{recipient,phone1}'), ''),
      phone2        = nullif(trim(p #>> '{recipient,phone2}'), '')
    where parcel_id = p_parcel and anonymised_at is null;
    if trim(coalesce(p #>> '{recipient,name}', '')) = '' or trim(coalesce(p #>> '{recipient,address_line1}', '')) = ''
       or trim(coalesce(p #>> '{recipient,city}', '')) = '' then
      raise exception 'Name, address and city are needed.' using errcode = 'P0001';
    end if;
  end if;
  if p ? 'tute_ids' then
    tids := array(select (x #>> '{}')::uuid from jsonb_array_elements(p -> 'tute_ids') as x);
    if coalesce(array_length(tids, 1), 0) = 0 then
      raise exception 'A parcel needs at least one tute.' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(tids) t where not exists
                 (select 1 from public.round_tutes rt where rt.id = t and rt.round_id = par.round_id)) then
      raise exception 'Unknown tute.' using errcode = 'P0001';
    end if;
    delete from public.parcel_items where parcel_id = p_parcel;
    insert into public.parcel_items (parcel_id, round_tute_id, qty)
    select p_parcel, rt.id, rt.qty_per_parcel from public.round_tutes rt where rt.id = any (tids);
  end if;

  update public.dispatch_rounds set manifest_version = manifest_version + 1 where id = par.round_id;
  update public.parcels
     set row_version = row_version + 1,
         manifest_version = (select manifest_version from public.dispatch_rounds where id = par.round_id),
         updated_at = now()
   where id = p_parcel;
  insert into public.parcel_events (parcel_id, round_id, type, actor, source, reason, details)
  values (p_parcel, par.round_id, 'corrected', actor, 'manual', left(trim(p_reason), 300),
          jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) as k)));
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Courier files and tracking numbers (courier capability)
-- -----------------------------------------------------------------------------
-- Record a file already uploaded to the private bucket. The same file twice returns the first record.
create or replace function public.carrier_file_record(
  p_round uuid, p_kind text, p_path text, p_name text, p_sha256 text, p_size integer, p_rows integer, p_summary jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  fid uuid;
begin
  if p_kind = 'citypak_template' then
    if not public.is_main_admin() then
      raise exception 'Only main admins can store the Citypak template.' using errcode = '42501';
    end if;
    actor := (select auth.uid());
    if p_path !~ '^templates/' then
      raise exception 'Invalid file.' using errcode = 'P0001';
    end if;
  else
    actor := public.dispatch_require('courier');
    if p_kind not in ('tracking_sheet', 'waybill_pdf') then
      raise exception 'Unknown file type.' using errcode = 'P0001';
    end if;
    if p_round is null or p_path !~ ('^rounds/' || p_round::text || '/') then
      raise exception 'Invalid file.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.dispatch_rounds where id = p_round and state in ('finalised', 'active')) then
      raise exception 'Courier files can be added only to finalised rounds.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.carrier_files (round_id, kind, storage_path, file_name, sha256, size_bytes, row_count, summary, created_by)
  values (p_round, p_kind, p_path, left(p_name, 200), lower(p_sha256), p_size, p_rows,
          case when jsonb_typeof(p_summary) = 'object' then p_summary else '{}'::jsonb end, actor)
  on conflict (coalesce(round_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, sha256) do nothing
  returning id into fid;
  if fid is null then
    select id into fid from public.carrier_files
     where coalesce(round_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_round, '00000000-0000-0000-0000-000000000000'::uuid)
       and kind = p_kind and sha256 = lower(p_sha256);
  end if;
  return fid;
end;
$$;

-- Apply tracking numbers from a Citypak sheet: [{reference, tracking_no}].
-- All or nothing. Re-applying the same numbers changes nothing. A parcel that
-- already has a different number, or a number used by another parcel, stops the import.
create or replace function public.tracking_apply(p_round uuid, p_file uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('courier');
  r public.dispatch_rounds;
  row_ jsonb;
  par public.parcels;
  ref text;
  trk text;
  applied integer := 0;
  unchanged integer := 0;
begin
  select * into r from public.dispatch_rounds where id = p_round for update;
  if r.id is null or r.state not in ('finalised', 'active') then
    raise exception 'Tracking numbers can be added only to finalised rounds.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.carrier_files where id = p_file and round_id = p_round and kind = 'tracking_sheet') then
    raise exception 'Upload the Citypak sheet first.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then
    raise exception 'Too many rows.' using errcode = 'P0001';
  end if;

  for row_ in select value from jsonb_array_elements(p_rows) loop
    ref := upper(trim(row_ ->> 'reference'));
    trk := upper(trim(row_ ->> 'tracking_no'));
    select * into par from public.parcels where reference = ref and round_id = p_round for update;
    if par.id is null then
      raise exception 'Reference % is not in this round.', ref using errcode = 'P0001';
    end if;
    if par.registration_state = 'voided' then
      raise exception 'Parcel % was voided.', ref using errcode = 'P0001';
    end if;
    if par.tracking_no = trk then
      unchanged := unchanged + 1;
      continue;
    end if;
    if par.tracking_no is not null then
      raise exception 'Parcel % already has tracking number %.', ref, par.tracking_no using errcode = 'P0001';
    end if;
    if exists (select 1 from public.parcels where tracking_no = trk) then
      raise exception 'Tracking number % is already used by another parcel.', trk using errcode = 'P0001';
    end if;
    update public.parcels
       set tracking_no = trk, registration_state = 'registered', row_version = row_version + 1, updated_at = now()
     where id = par.id;
    insert into public.parcel_events (parcel_id, round_id, type, from_state, to_state, actor, source, details)
    values (par.id, p_round, 'registered', 'unregistered', 'registered', actor, 'import',
            jsonb_build_object('tracking_no', trk, 'file_id', p_file));
    applied := applied + 1;
  end loop;

  if applied > 0 and r.state = 'finalised' then
    update public.dispatch_rounds set state = 'active', updated_by = actor, updated_at = now() where id = p_round;
  end if;
  if applied > 0 then
    perform public.write_activity('dispatch.tracking_imported', 'dispatch', p_round::text, null,
      'Added ' || applied || ' tracking number' || case when applied = 1 then '' else 's' end || ' to ' || r.name,
      jsonb_build_object('round_id', p_round, 'file_id', p_file, 'applied', applied, 'unchanged', unchanged));
  end if;
  return jsonb_build_object('applied', applied, 'unchanged', unchanged);
end;
$$;

-- Main admins mark the stored Citypak template as checked (export uses it later).
create or replace function public.citypak_template_set(p_file uuid, p_verified boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can verify the Citypak template.' using errcode = '42501';
  end if;
  if p_file is not null and not exists (select 1 from public.carrier_files where id = p_file and kind = 'citypak_template') then
    raise exception 'Template file not found.' using errcode = 'P0001';
  end if;
  update public.dispatch_settings set
    citypak_template_file = p_file,
    citypak_template_verified = coalesce(p_verified, false) and p_file is not null,
    citypak_template_verified_by = case when p_verified then (select auth.uid()) end,
    citypak_template_verified_at = case when p_verified then now() end
  where id;
  perform public.write_activity('dispatch.template_set', 'dispatch', p_file::text, null,
    case when p_verified then 'Marked the Citypak template as verified' else 'Stored a Citypak template (not verified)' end,
    '{}'::jsonb);
end;
$$;

-- Log every download of a courier file (they hold personal data).
create or replace function public.dispatch_log_download(p_file uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.carrier_files;
begin
  if not (public.has_dispatch('courier') or public.has_dispatch('plan')) then
    raise exception 'You are not allowed to download dispatch files.' using errcode = '42501';
  end if;
  select * into f from public.carrier_files where id = p_file and deleted_at is null;
  if f.id is null then
    raise exception 'File not found.' using errcode = 'P0001';
  end if;
  perform public.write_activity('dispatch.file_downloaded', 'dispatch', f.id::text, null,
    'Downloaded ' || f.file_name, jsonb_build_object('kind', f.kind, 'round_id', f.round_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Storage: rounds/<round_id>/... for courier files, templates/ for main admins
-- -----------------------------------------------------------------------------
drop policy if exists "dispatch bucket: courier uploads round files" on storage.objects;
create policy "dispatch bucket: courier uploads round files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dispatch' and (storage.foldername(name))[1] = 'rounds' and (select public.has_dispatch('courier')));

drop policy if exists "dispatch bucket: courier and planners read round files" on storage.objects;
create policy "dispatch bucket: courier and planners read round files"
  on storage.objects for select to authenticated
  using (bucket_id = 'dispatch' and (storage.foldername(name))[1] in ('rounds', 'templates')
         and ((select public.has_dispatch('courier')) or (select public.has_dispatch('plan'))));

drop policy if exists "dispatch bucket: main admins upload templates" on storage.objects;
create policy "dispatch bucket: main admins upload templates"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dispatch' and (storage.foldername(name))[1] = 'templates' and (select public.is_main_admin()));

-- -----------------------------------------------------------------------------
-- 7. Row level security (read only)
-- -----------------------------------------------------------------------------
alter table public.dispatch_rounds   enable row level security;
alter table public.round_tutes       enable row level security;
alter table public.round_students    enable row level security;
alter table public.parcels           enable row level security;
alter table public.parcel_recipients enable row level security;
alter table public.parcel_items      enable row level security;
alter table public.parcel_events     enable row level security;
alter table public.carrier_files     enable row level security;

-- Progress (no personal data) for everyone with the dispatch page.
drop policy if exists "dispatch_rounds: dispatch users read" on public.dispatch_rounds;
create policy "dispatch_rounds: dispatch users read" on public.dispatch_rounds for select to authenticated
  using ((select public.has_page('dispatch')));
drop policy if exists "round_tutes: dispatch users read" on public.round_tutes;
create policy "round_tutes: dispatch users read" on public.round_tutes for select to authenticated
  using ((select public.has_page('dispatch')));
drop policy if exists "parcels: dispatch users read" on public.parcels;
create policy "parcels: dispatch users read" on public.parcels for select to authenticated
  using ((select public.has_page('dispatch')));
drop policy if exists "parcel_items: dispatch users read" on public.parcel_items;
create policy "parcel_items: dispatch users read" on public.parcel_items for select to authenticated
  using ((select public.has_page('dispatch')));

-- Planning and personal data: plan and courier only.
drop policy if exists "round_students: planners read" on public.round_students;
create policy "round_students: planners read" on public.round_students for select to authenticated
  using ((select public.has_dispatch('plan')) or (select public.has_dispatch('courier')));
drop policy if exists "parcel_recipients: planners and courier read" on public.parcel_recipients;
create policy "parcel_recipients: planners and courier read" on public.parcel_recipients for select to authenticated
  using ((select public.has_dispatch('plan')) or (select public.has_dispatch('courier')));
drop policy if exists "parcel_events: planners and courier read" on public.parcel_events;
create policy "parcel_events: planners and courier read" on public.parcel_events for select to authenticated
  using ((select public.has_dispatch('plan')) or (select public.has_dispatch('courier')));
drop policy if exists "carrier_files: planners and courier read" on public.carrier_files;
create policy "carrier_files: planners and courier read" on public.carrier_files for select to authenticated
  using ((select public.has_dispatch('plan')) or (select public.has_dispatch('courier')));

-- -----------------------------------------------------------------------------
-- 8. Privileges
-- -----------------------------------------------------------------------------
revoke all on table public.dispatch_rounds, public.round_tutes, public.round_students, public.parcels,
  public.parcel_recipients, public.parcel_items, public.parcel_events, public.carrier_files
  from anon, authenticated;
grant select on table public.dispatch_rounds, public.round_tutes, public.round_students, public.parcels,
  public.parcel_recipients, public.parcel_items, public.parcel_events, public.carrier_files
  to authenticated;

revoke all on function public.parcel_events_append_only() from public, anon, authenticated;
revoke all on function public.dispatch_require(text) from public, anon, authenticated;
revoke all on function public.dispatch_lock_draft(uuid) from public, anon, authenticated;
revoke all on function public.round_save(jsonb) from public, anon, authenticated;
revoke all on function public.round_set_tutes(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.round_set_students(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.round_cancel(uuid, text) from public, anon, authenticated;
revoke all on function public.round_finalise(uuid) from public, anon, authenticated;
revoke all on function public.parcel_correct(uuid, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.carrier_file_record(uuid, text, text, text, text, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.tracking_apply(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.citypak_template_set(uuid, boolean) from public, anon, authenticated;
revoke all on function public.dispatch_log_download(uuid) from public, anon, authenticated;

grant execute on function public.round_save(jsonb) to authenticated;
grant execute on function public.round_set_tutes(uuid, jsonb) to authenticated;
grant execute on function public.round_set_students(uuid, jsonb) to authenticated;
grant execute on function public.round_cancel(uuid, text) to authenticated;
grant execute on function public.round_finalise(uuid) to authenticated;
grant execute on function public.parcel_correct(uuid, jsonb, text, integer) to authenticated;
grant execute on function public.carrier_file_record(uuid, text, text, text, text, integer, integer, jsonb) to authenticated;
grant execute on function public.tracking_apply(uuid, uuid, jsonb) to authenticated;
grant execute on function public.citypak_template_set(uuid, boolean) to authenticated;
grant execute on function public.dispatch_log_download(uuid) to authenticated;
