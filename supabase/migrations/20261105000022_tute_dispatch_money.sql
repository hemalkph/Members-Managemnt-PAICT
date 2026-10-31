-- =============================================================================
-- Tute dispatch: COD settlements, write-offs, closing and reopening rounds,
-- reports and the nightly retention clean-up. Safe to run more than once.
--
-- Money rules
--   * "Delivered" never means "paid". A parcel is paid only by lines of a
--     CONFIRMED settlement (what Citypak actually paid us).
--   * Due = the parcel's COD when it was delivered, otherwise 0. Anything paid
--     for a parcel that is not delivered shows up as an overpayment to check.
--   * Outstanding = due − paid − written off. A shortfall can be written off
--     with a reason (finance permission).
--   * A settlement's lines (collected − fee) must add up to what was remitted;
--     if they don't, confirming needs a dispute note, which stays on record.
-- Closing a round (plan permission) needs: no open handover, every live parcel
-- delivered or returned, nothing outstanding and no parcel in a draft
-- settlement. Open problem reports don't block; they stay visible. Reopening
-- needs a main admin and a reason.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables and columns
-- -----------------------------------------------------------------------------
alter table public.parcels add column if not exists cod_writeoff numeric(12, 2) not null default 0;
alter table public.parcels add column if not exists cod_writeoff_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parcels_cod_writeoff_range') then
    alter table public.parcels add constraint parcels_cod_writeoff_range
      check (cod_writeoff >= 0 and cod_writeoff <= 1000000 and char_length(cod_writeoff_reason) <= 300);
  end if;
end;
$$;

create table if not exists public.cod_settlements (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null check (char_length(trim(reference)) between 1 and 60),
  settled_on    date not null,
  remitted      numeric(12, 2) not null check (remitted >= 0 and remitted <= 100000000),
  note          text not null default '' check (char_length(note) <= 300),
  file_id       uuid references public.carrier_files (id) on delete set null,
  state         text not null default 'draft' check (state in ('draft', 'confirmed', 'cancelled')),
  dispute_note  text check (char_length(dispute_note) <= 300),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  confirmed_by  uuid references public.profiles (id) on delete set null,
  confirmed_at  timestamptz,
  cancelled_by  uuid references public.profiles (id) on delete set null,
  cancelled_at  timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 300)
);
-- The same Citypak settlement can't be entered twice.
create unique index if not exists cod_settlements_reference_unique on public.cod_settlements (lower(trim(reference))) where state <> 'cancelled';
create index if not exists cod_settlements_date_idx on public.cod_settlements (settled_on desc);

create table if not exists public.cod_settlement_lines (
  id            uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.cod_settlements (id) on delete cascade,
  parcel_id     uuid not null references public.parcels (id) on delete restrict,
  collected     numeric(12, 2) not null check (collected >= 0 and collected <= 1000000),
  fee           numeric(12, 2) not null default 0 check (fee >= 0 and fee <= 1000000),
  added_by      uuid references public.profiles (id) on delete set null,
  added_at      timestamptz not null default now(),
  unique (settlement_id, parcel_id)
);
create index if not exists cod_settlement_lines_parcel_idx on public.cod_settlement_lines (parcel_id);

-- Settlement reports from Citypak are kept as financial records (never auto-deleted).
alter table public.carrier_files drop constraint if exists carrier_files_storage_path_check;
alter table public.carrier_files add constraint carrier_files_storage_path_check
  check (storage_path ~ '^(rounds/[0-9a-f-]{36}|templates)/[0-9a-f-]{36}\.(xlsx|csv|pdf)$'
         or storage_path ~ '^receipts/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'
         or storage_path ~ '^settlements/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|xlsx|csv|jpg|png|webp)$');

-- -----------------------------------------------------------------------------
-- 2. COD status of each parcel
-- -----------------------------------------------------------------------------
-- One row per parcel of the round (all rounds when p_round is null: then only
-- parcels that need attention). Money columns come from confirmed settlements.
create or replace function public.dispatch_cod_rows(p_round uuid, p_attention_only boolean default false)
returns table (
  parcel_id uuid, round_id uuid, round_name text, reference text, tracking_no text, delivery_state text,
  registration_state text, cod_expected numeric, due numeric, paid numeric, fees numeric, pending numeric,
  written_off numeric, writeoff_reason text, outstanding numeric, status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select p.id, p.round_id, r.name as round_name, p.reference, p.tracking_no, p.delivery_state, p.registration_state,
           p.cod_expected, p.cod_writeoff, p.cod_writeoff_reason,
           case when p.delivery_state = 'delivered' and p.registration_state <> 'voided' then p.cod_expected else 0 end as due,
           coalesce(sum(l.collected) filter (where s.state = 'confirmed'), 0) as paid,
           coalesce(sum(l.fee) filter (where s.state = 'confirmed'), 0) as fees,
           coalesce(sum(l.collected) filter (where s.state = 'draft'), 0) as pending,
           count(l.id) filter (where s.state = 'draft') as in_draft
      from public.parcels p
      join public.dispatch_rounds r on r.id = p.round_id
      left join public.cod_settlement_lines l on l.parcel_id = p.id
      left join public.cod_settlements s on s.id = l.settlement_id
     where (p_round is null or p.round_id = p_round)
     group by p.id, r.name
  ), rows as (
    select b.*, b.due - b.paid - b.cod_writeoff as outstanding,
           case
             when b.registration_state = 'voided' and b.paid = 0 and b.in_draft = 0 then 'voided'
             when b.delivery_state not in ('delivered', 'returned') and b.registration_state <> 'voided' and b.paid = 0 and b.in_draft = 0 then 'waiting'
             when b.in_draft > 0 then 'in_draft'
             when b.due - b.paid - b.cod_writeoff < 0 then 'over'
             when b.due - b.paid - b.cod_writeoff = 0 then case when b.due = 0 and b.paid = 0 then 'nothing_due' else 'settled' end
             when b.paid = 0 and b.cod_writeoff = 0 then 'unpaid'
             else 'part_paid'
           end as status
      from base b
  )
  select id, round_id, round_name, reference, tracking_no, delivery_state, registration_state, cod_expected, due, paid, fees,
         pending, cod_writeoff, cod_writeoff_reason, outstanding, status
    from rows
   where public.has_dispatch('finance')
     and (not p_attention_only or status in ('unpaid', 'part_paid', 'over', 'in_draft'))
   order by round_name, reference
   limit 20000;
$$;

-- Round totals used by the close check and reports (no permission check: internal).
create or replace function public.dispatch_round_totals(p_round uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select p.*,
           case when p.delivery_state = 'delivered' and p.registration_state <> 'voided' then p.cod_expected else 0 end as due,
           coalesce((select sum(l.collected) from public.cod_settlement_lines l join public.cod_settlements s on s.id = l.settlement_id
                      where l.parcel_id = p.id and s.state = 'confirmed'), 0) as paid,
           coalesce((select sum(l.fee) from public.cod_settlement_lines l join public.cod_settlements s on s.id = l.settlement_id
                      where l.parcel_id = p.id and s.state = 'confirmed'), 0) as fees,
           exists (select 1 from public.cod_settlement_lines l join public.cod_settlements s on s.id = l.settlement_id
                    where l.parcel_id = p.id and s.state = 'draft') as in_draft
      from public.parcels p where p.round_id = p_round
  )
  select jsonb_build_object(
    'live',          count(*) filter (where registration_state <> 'voided'),
    'voided',        count(*) filter (where registration_state = 'voided'),
    'replacements',  count(*) filter (where replaces_parcel_id is not null and registration_state <> 'voided'),
    'handed_over',   count(*) filter (where registration_state <> 'voided' and delivery_state <> 'awaiting_pickup'),
    'delivered',     count(*) filter (where registration_state <> 'voided' and delivery_state = 'delivered'),
    'returned',      count(*) filter (where registration_state <> 'voided' and delivery_state = 'returned'),
    'unresolved',    count(*) filter (where registration_state <> 'voided' and delivery_state not in ('delivered', 'returned')),
    'cod_expected',  coalesce(sum(due), 0),
    'cod_paid',      coalesce(sum(paid), 0),
    'cod_fees',      coalesce(sum(fees), 0),
    'cod_written_off', coalesce(sum(cod_writeoff), 0),
    'cod_outstanding', coalesce(sum(greatest(due - paid - cod_writeoff, 0)), 0),
    'cod_over',      coalesce(sum(greatest(paid + cod_writeoff - due, 0)), 0),
    'owing_parcels', count(*) filter (where due - paid - cod_writeoff > 0),
    'in_draft',      count(*) filter (where in_draft),
    'open_exceptions', (select count(*) from public.parcel_exceptions e where e.round_id = p_round and e.resolved_at is null),
    'open_handover', exists (select 1 from public.handovers h where h.round_id = p_round and h.state = 'open')
  ) from p;
$$;

-- -----------------------------------------------------------------------------
-- 3. Settlements (finance permission)
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_settlement_draft(p_id uuid)
returns public.cod_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.cod_settlements;
begin
  select * into s from public.cod_settlements where id = p_id for update;
  if s.id is null then
    raise exception 'Settlement not found.' using errcode = 'P0001';
  end if;
  if s.state <> 'draft' then
    raise exception 'This settlement is % and can no longer be changed.', s.state using errcode = 'P0001';
  end if;
  return s;
end;
$$;

-- p: {reference, settled_on, remitted, note}
create or replace function public.settlement_save(p_id uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('finance');
  sid uuid := p_id;
  ref text := trim(coalesce(p ->> 'reference', ''));
begin
  if ref = '' then
    raise exception 'Enter the settlement reference.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cod_settlements where lower(trim(reference)) = lower(ref) and state <> 'cancelled' and id is distinct from p_id) then
    raise exception 'Settlement % is already entered.', ref using errcode = '23505';
  end if;
  if sid is null then
    insert into public.cod_settlements (reference, settled_on, remitted, note, created_by)
    values (left(ref, 60), (p ->> 'settled_on')::date, coalesce((p ->> 'remitted')::numeric, 0), left(trim(coalesce(p ->> 'note', '')), 300), actor)
    returning id into sid;
  else
    perform public.dispatch_settlement_draft(sid);
    update public.cod_settlements
       set reference = left(ref, 60), settled_on = (p ->> 'settled_on')::date,
           remitted = coalesce((p ->> 'remitted')::numeric, remitted), note = left(trim(coalesce(p ->> 'note', '')), 300)
     where id = sid;
  end if;
  return sid;
end;
$$;

-- Add parcels by tracking number or reference. p_rows: [{code, collected?, fee?}].
-- Collected defaults to what is still owed. Never raises for a bad row.
create or replace function public.settlement_add_lines(p_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('finance');
  row_ jsonb;
  code text;
  par public.parcels;
  owed numeric;
  added integer := 0;
  problems jsonb := '[]'::jsonb;
  other text;
begin
  perform public.dispatch_settlement_draft(p_id);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Add up to 2,000 parcels at a time.' using errcode = 'P0001';
  end if;
  for row_ in select * from jsonb_array_elements(p_rows) loop
    code := left(upper(regexp_replace(coalesce(row_ ->> 'code', ''), '\s', '', 'g')), 64);
    par := null;
    if code ~ '^D[0-9]{8}$' then
      select * into par from public.parcels where tracking_no = code for update;
    else
      select * into par from public.parcels where reference = code for update;
    end if;
    if par.id is null then
      problems := problems || jsonb_build_object('code', code, 'message', 'No parcel has this code.');
      continue;
    end if;
    if exists (select 1 from public.dispatch_rounds where id = par.round_id and state = 'closed') then
      problems := problems || jsonb_build_object('code', code, 'message', 'Its round is closed.');
      continue;
    end if;
    if par.delivery_state not in ('delivered', 'returned') then
      problems := problems || jsonb_build_object('code', code, 'message', 'It is not delivered or returned yet.');
      continue;
    end if;
    if exists (select 1 from public.cod_settlement_lines where settlement_id = p_id and parcel_id = par.id) then
      problems := problems || jsonb_build_object('code', code, 'message', 'Already in this settlement.');
      continue;
    end if;
    select s.reference into other from public.cod_settlement_lines l join public.cod_settlements s on s.id = l.settlement_id
     where l.parcel_id = par.id and s.state = 'draft' limit 1;
    if other is not null then
      problems := problems || jsonb_build_object('code', code, 'message', 'Already in settlement ' || other || '.');
      continue;
    end if;
    owed := (case when par.delivery_state = 'delivered' and par.registration_state <> 'voided' then par.cod_expected else 0 end)
            - par.cod_writeoff
            - coalesce((select sum(l.collected) from public.cod_settlement_lines l join public.cod_settlements s on s.id = l.settlement_id
                         where l.parcel_id = par.id and s.state = 'confirmed'), 0);
    if (row_ ->> 'collected') is null and owed <= 0 and par.delivery_state = 'delivered' then
      problems := problems || jsonb_build_object('code', code, 'message', 'Nothing is owed for this parcel.');
      continue;
    end if;
    begin
      insert into public.cod_settlement_lines (settlement_id, parcel_id, collected, fee, added_by)
      values (p_id, par.id, coalesce((row_ ->> 'collected')::numeric, greatest(owed, 0)), coalesce((row_ ->> 'fee')::numeric, 0), actor);
      added := added + 1;
    exception
      when unique_violation then
        problems := problems || jsonb_build_object('code', code, 'message', 'Already in this settlement.');
      when check_violation or invalid_text_representation then
        problems := problems || jsonb_build_object('code', code, 'message', 'The amount is not valid.');
    end;
  end loop;
  return jsonb_build_object('added', added, 'problems', problems);
end;
$$;

create or replace function public.settlement_set_line(p_line uuid, p_collected numeric, p_fee numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('finance');
  sid uuid;
begin
  select settlement_id into sid from public.cod_settlement_lines where id = p_line;
  if sid is null then
    raise exception 'Line not found.' using errcode = 'P0001';
  end if;
  perform public.dispatch_settlement_draft(sid);
  update public.cod_settlement_lines set collected = p_collected, fee = coalesce(p_fee, 0) where id = p_line;
end;
$$;

create or replace function public.settlement_remove_line(p_line uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('finance');
  sid uuid;
begin
  select settlement_id into sid from public.cod_settlement_lines where id = p_line;
  if sid is null then
    return;
  end if;
  perform public.dispatch_settlement_draft(sid);
  delete from public.cod_settlement_lines where id = p_line;
end;
$$;

create or replace function public.settlement_attach(p_id uuid, p_file uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('finance');
begin
  if not exists (select 1 from public.cod_settlements where id = p_id and state <> 'cancelled') then
    raise exception 'Settlement not found.' using errcode = 'P0001';
  end if;
  if p_file is not null and not exists (select 1 from public.carrier_files where id = p_file and kind = 'settlement_report'
                                         and storage_path ~ ('^settlements/' || p_id::text || '/')) then
    raise exception 'File not found.' using errcode = 'P0001';
  end if;
  update public.cod_settlements set file_id = p_file where id = p_id;
end;
$$;

-- Confirm: the lines now count as paid. A difference needs a dispute note.
create or replace function public.settlement_confirm(p_id uuid, p_dispute_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('finance');
  s public.cod_settlements := public.dispatch_settlement_draft(p_id);
  n integer;
  net numeric;
  diff numeric;
begin
  select count(*), coalesce(sum(collected - fee), 0) into n, net from public.cod_settlement_lines where settlement_id = s.id;
  if n = 0 then
    raise exception 'Add the parcels this settlement pays for first.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cod_settlement_lines l join public.parcels p on p.id = l.parcel_id
              join public.dispatch_rounds r on r.id = p.round_id where l.settlement_id = s.id and r.state = 'closed') then
    raise exception 'A parcel in this settlement belongs to a closed round.' using errcode = 'P0001';
  end if;
  diff := s.remitted - net;
  if diff <> 0 and char_length(trim(coalesce(p_dispute_note, ''))) < 3 then
    raise exception 'The parcels add up to Rs. % but Rs. % was remitted. Explain the difference to confirm.', net, s.remitted
      using errcode = 'P0001';
  end if;
  update public.cod_settlements
     set state = 'confirmed', confirmed_by = actor, confirmed_at = now(),
         dispute_note = case when diff <> 0 then left(trim(p_dispute_note), 300) end
   where id = s.id;
  insert into public.parcel_events (parcel_id, round_id, type, actor, source, details)
  select p.id, p.round_id, 'cod_settled', actor, 'manual',
         jsonb_build_object('settlement', s.reference, 'collected', l.collected, 'fee', l.fee)
    from public.cod_settlement_lines l join public.parcels p on p.id = l.parcel_id
   where l.settlement_id = s.id;
  perform public.write_activity('dispatch.settlement_confirmed', 'dispatch', s.id::text, null,
    'Confirmed COD settlement ' || s.reference || ' (' || n || ' parcels, Rs. ' || s.remitted || ')',
    jsonb_build_object('difference', diff));
  return jsonb_build_object('parcels', n, 'difference', diff);
end;
$$;

-- Cancel: a draft needs finance; a confirmed settlement needs the correct
-- permission too, and no parcel in it may belong to a closed round.
create or replace function public.settlement_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('finance');
  s public.cod_settlements;
begin
  select * into s from public.cod_settlements where id = p_id for update;
  if s.id is null or s.state = 'cancelled' then
    raise exception 'This settlement is not open.' using errcode = 'P0001';
  end if;
  if s.state = 'confirmed' then
    if not public.has_dispatch('correct') then
      raise exception 'Cancelling a confirmed settlement needs the correct permission.' using errcode = '42501';
    end if;
    if char_length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception 'Give a reason.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.cod_settlement_lines l join public.parcels p on p.id = l.parcel_id
                join public.dispatch_rounds r on r.id = p.round_id where l.settlement_id = s.id and r.state = 'closed') then
      raise exception 'A parcel in this settlement belongs to a closed round. Reopen the round first.' using errcode = 'P0001';
    end if;
    insert into public.parcel_events (parcel_id, round_id, type, actor, source, reason, details)
    select p.id, p.round_id, 'cod_settlement_cancelled', actor, 'manual', left(trim(p_reason), 300), jsonb_build_object('settlement', s.reference)
      from public.cod_settlement_lines l join public.parcels p on p.id = l.parcel_id
     where l.settlement_id = s.id;
  end if;
  update public.cod_settlements
     set state = 'cancelled', cancelled_by = actor, cancelled_at = now(), cancel_reason = left(trim(coalesce(p_reason, '')), 300)
   where id = s.id;
  perform public.write_activity('dispatch.settlement_cancelled', 'dispatch', s.id::text, null,
    'Cancelled COD settlement ' || s.reference, jsonb_build_object('was', s.state));
end;
$$;

-- Write off a shortfall (0 clears it). Can't write off more than is owed.
create or replace function public.cod_writeoff_set(p_parcel uuid, p_amount numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('finance');
  par public.parcels;
  owed numeric;
begin
  select * into par from public.parcels where id = p_parcel for update;
  if par.id is null then
    raise exception 'Parcel not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.dispatch_rounds where id = par.round_id and state = 'closed') then
    raise exception 'The round is closed.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Enter an amount.' using errcode = 'P0001';
  end if;
  if p_amount > 0 and char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for the write-off.' using errcode = 'P0001';
  end if;
  owed := (case when par.delivery_state = 'delivered' and par.registration_state <> 'voided' then par.cod_expected else 0 end)
          - coalesce((select sum(l.collected) from public.cod_settlement_lines l join public.cod_settlements s on s.id = l.settlement_id
                       where l.parcel_id = par.id and s.state = 'confirmed'), 0);
  if p_amount > greatest(owed, 0) then
    raise exception 'Only Rs. % is owed for this parcel.', greatest(owed, 0) using errcode = 'P0001';
  end if;
  update public.parcels
     set cod_writeoff = p_amount, cod_writeoff_reason = case when p_amount > 0 then left(trim(p_reason), 300) end,
         row_version = row_version + 1, updated_at = now()
   where id = par.id;
  insert into public.parcel_events (parcel_id, round_id, type, actor, source, reason, details)
  values (par.id, par.round_id, 'cod_writeoff', actor, 'manual', nullif(left(trim(coalesce(p_reason, '')), 300), ''),
          jsonb_build_object('from', par.cod_writeoff, 'to', p_amount));
end;
$$;

-- The settlement list and one settlement's lines (finance).
create or replace function public.dispatch_settlements()
returns table (
  id uuid, reference text, settled_on date, remitted numeric, note text, state text, dispute_note text, file_id uuid,
  parcels integer, collected numeric, fees numeric, created_name text, confirmed_name text, confirmed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.reference, s.settled_on, s.remitted, s.note, s.state, s.dispute_note, s.file_id,
         count(l.id)::integer, coalesce(sum(l.collected), 0), coalesce(sum(l.fee), 0),
         public.dispatch_name(s.created_by), public.dispatch_name(s.confirmed_by), s.confirmed_at
    from public.cod_settlements s left join public.cod_settlement_lines l on l.settlement_id = s.id
   where public.has_dispatch('finance')
   group by s.id
   order by s.settled_on desc, s.created_at desc
   limit 500;
$$;

-- -----------------------------------------------------------------------------
-- 4. Closing and reopening rounds
-- -----------------------------------------------------------------------------
-- What closing would mean, and what still blocks it. Readable with the page.
create or replace function public.round_close_check(p_round uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.dispatch_rounds;
  t jsonb;
  blockers jsonb := '[]'::jsonb;
begin
  if not public.has_page('dispatch') then
    raise exception 'You are not allowed to see this round.' using errcode = '42501';
  end if;
  select * into r from public.dispatch_rounds where id = p_round;
  if r.id is null then
    raise exception 'Round not found.' using errcode = 'P0001';
  end if;
  t := public.dispatch_round_totals(p_round);
  if r.state not in ('finalised', 'active') then
    blockers := blockers || to_jsonb('The round is ' || r.state || '.');
  end if;
  if (t ->> 'open_handover')::boolean then
    blockers := blockers || to_jsonb('A handover is still open – confirm or cancel it.'::text);
  end if;
  if (t ->> 'unresolved')::integer > 0 then
    blockers := blockers || to_jsonb((t ->> 'unresolved') || ' parcel(s) are not delivered or returned – update them, or void them.');
  end if;
  if (t ->> 'in_draft')::integer > 0 then
    blockers := blockers || to_jsonb((t ->> 'in_draft') || ' parcel(s) are in a draft settlement – confirm or cancel it.');
  end if;
  if (t ->> 'owing_parcels')::integer > 0 then
    blockers := blockers || to_jsonb((t ->> 'owing_parcels') || ' delivered parcel(s) still owe COD (Rs. ' || (t ->> 'cod_outstanding')
                                     || ') – record the settlement, or write the shortfall off.');
  end if;
  return t || jsonb_build_object('state', r.state, 'blockers', blockers, 'can_close', jsonb_array_length(blockers) = 0,
                                 'closed_at', r.closed_at, 'closed_name', public.dispatch_name(r.closed_by), 'close_note', r.close_note);
end;
$$;

create or replace function public.round_close(p_round uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
  c jsonb;
begin
  perform 1 from public.dispatch_rounds where id = p_round for update;
  c := public.round_close_check(p_round);
  if not (c ->> 'can_close')::boolean then
    raise exception 'Can''t close yet: %', c -> 'blockers' ->> 0 using errcode = 'P0001';
  end if;
  update public.dispatch_rounds
     set state = 'closed', closed_by = actor, closed_at = now(), close_note = nullif(left(trim(coalesce(p_note, '')), 500), ''),
         updated_by = actor, updated_at = now()
   where id = p_round;
  perform public.write_activity('dispatch.round_closed', 'dispatch', p_round::text, null,
    'Closed a tute dispatch round', c - 'blockers');
end;
$$;

create or replace function public.round_reopen(p_round uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can reopen a round.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason.' using errcode = 'P0001';
  end if;
  update public.dispatch_rounds
     set state = 'active', closed_by = null, closed_at = null, close_note = null, updated_by = actor, updated_at = now()
   where id = p_round and state = 'closed';
  if not found then
    raise exception 'This round is not closed.' using errcode = 'P0001';
  end if;
  perform public.write_activity('dispatch.round_reopened', 'dispatch', p_round::text, null,
    'Reopened a tute dispatch round: ' || left(trim(p_reason), 300), '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Reports
-- -----------------------------------------------------------------------------
-- One row per round sent in the month range. Money received only with finance.
create or replace function public.dispatch_report_rounds(p_from date, p_to date)
returns table (
  round_id uuid, name text, sending_month date, state text, live integer, voided integer, replacements integer,
  handed_over integer, delivered integer, returned integer, unresolved integer, open_exceptions integer,
  cod_expected numeric, cod_paid numeric, cod_fees numeric, cod_written_off numeric, cod_outstanding numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  money boolean := public.has_dispatch('finance');
begin
  if not (public.has_dispatch('plan') or public.has_dispatch('finance') or public.has_dispatch('courier')) then
    raise exception 'You are not allowed to see dispatch reports.' using errcode = '42501';
  end if;
  return query
    select r.id, r.name, r.sending_month, r.state,
           (t ->> 'live')::integer, (t ->> 'voided')::integer, (t ->> 'replacements')::integer,
           (t ->> 'handed_over')::integer, (t ->> 'delivered')::integer, (t ->> 'returned')::integer,
           (t ->> 'unresolved')::integer, (t ->> 'open_exceptions')::integer,
           (t ->> 'cod_expected')::numeric,
           case when money then (t ->> 'cod_paid')::numeric end,
           case when money then (t ->> 'cod_fees')::numeric end,
           case when money then (t ->> 'cod_written_off')::numeric end,
           case when money then (t ->> 'cod_outstanding')::numeric end
      from public.dispatch_rounds r
     cross join lateral public.dispatch_round_totals(r.id) as t
     where r.state <> 'draft' and r.state <> 'cancelled'
       and r.sending_month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
     order by r.sending_month, r.name
     limit 500;
end;
$$;

-- Who packed, verified and handed over parcels in rounds of the month range.
create or replace function public.dispatch_report_people(p_from date, p_to date)
returns table (name text, packed integer, verified integer, handed_over integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_dispatch('plan') or public.has_dispatch('finance')) then
    raise exception 'You are not allowed to see dispatch reports.' using errcode = '42501';
  end if;
  return query
    with rounds as (
      select id from public.dispatch_rounds
       where state not in ('draft', 'cancelled')
         and sending_month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
    ), work as (
      select packed_by as who, 1 as packed, 0 as verified, 0 as handed from public.parcels
       where round_id in (select id from rounds) and packed_by is not null
      union all
      select verified_by, 0, 1, 0 from public.parcels where round_id in (select id from rounds) and verified_by is not null
      union all
      select h.confirmed_by, 0, 0, (select count(*)::integer from public.handover_parcels hp where hp.handover_id = h.id and hp.released_at is null)
        from public.handovers h where h.round_id in (select id from rounds) and h.state = 'confirmed' and h.confirmed_by is not null
    )
    select public.dispatch_name(w.who), sum(w.packed)::integer, sum(w.verified)::integer, sum(w.handed)::integer
      from work w group by w.who order by 2 desc, 3 desc limit 200;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Retention (run nightly by the server with the service role only)
-- -----------------------------------------------------------------------------
-- Removes names, addresses and phone numbers that are no longer needed:
--   * parcel recipients, N days after their round closed (recipient_retention_days)
--   * students of a batch, N months after the batch's last round closed, when
--     the batch has no open round left (student_retention_months).
-- Parcels, references, tracking numbers, totals and history are kept.
create or replace function public.dispatch_retention_run(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.dispatch_settings;
  recipients integer;
  students integer;
begin
  select * into st from public.dispatch_settings limit 1;
  update public.parcel_recipients pr
     set name = 'Removed', address_line1 = '', address_line2 = '', address_line3 = '', city = '',
         phone1 = null, phone2 = null, anonymised_at = p_now
    from public.parcels p join public.dispatch_rounds r on r.id = p.round_id
   where pr.parcel_id = p.id and pr.anonymised_at is null
     and r.state = 'closed' and r.closed_at < p_now - make_interval(days => coalesce(st.recipient_retention_days, 180));
  get diagnostics recipients = row_count;

  update public.students s
     set full_name = 'Removed', address_line1 = '', address_line2 = '', address_line3 = '', city = '', region = '',
         phone1 = null, phone2 = null, phone1_raw = null, delivery_note = '', is_active = false, anonymised_at = p_now, updated_at = p_now
   where s.anonymised_at is null
     and exists (select 1 from public.dispatch_rounds r where r.batch_id = s.batch_id and r.state = 'closed')
     and not exists (select 1 from public.dispatch_rounds r where r.batch_id = s.batch_id and r.state in ('draft', 'finalised', 'active'))
     and (select max(r.closed_at) from public.dispatch_rounds r where r.batch_id = s.batch_id and r.state = 'closed')
         < p_now - make_interval(months => coalesce(st.student_retention_months, 12));
  get diagnostics students = row_count;

  return jsonb_build_object('recipients', recipients, 'students', students);
end;
$$;

-- Courier files (sheets, waybills, receipts) of rounds closed long enough ago.
-- Settlement reports are financial records and are kept.
create or replace function public.dispatch_retention_files(p_now timestamptz default now())
returns table (id uuid, storage_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.storage_path
    from public.carrier_files f join public.dispatch_rounds r on r.id = f.round_id
   where f.deleted_at is null and f.kind in ('tracking_sheet', 'waybill_pdf', 'handover_receipt', 'manifest_export', 'status_report')
     and r.state = 'closed'
     and r.closed_at < p_now - make_interval(days => coalesce((select courier_file_retention_days from public.dispatch_settings limit 1), 90))
   order by f.created_at
   limit 1000;
$$;

create or replace function public.dispatch_retention_mark_deleted(p_ids uuid[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (
    update public.carrier_files set deleted_at = now() where id = any (p_ids) and deleted_at is null returning 1
  ) select count(*)::integer from d;
$$;

-- -----------------------------------------------------------------------------
-- 7. Courier files: settlement reports (finance)
-- -----------------------------------------------------------------------------
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
  elsif p_kind = 'settlement_report' then
    actor := public.dispatch_require('finance');
    if p_round is not null or p_path !~ '^settlements/' then
      raise exception 'Invalid file.' using errcode = 'P0001';
    end if;
  else
    if p_kind = 'handover_receipt' then
      if not (public.has_dispatch('verify') or public.has_dispatch('courier')) then
        raise exception 'You are not allowed to add handover receipts.' using errcode = '42501';
      end if;
      actor := (select auth.uid());
    else
      actor := public.dispatch_require('courier');
      if p_kind not in ('tracking_sheet', 'waybill_pdf') then
        raise exception 'Unknown file type.' using errcode = 'P0001';
      end if;
    end if;
    if p_round is null or p_path !~ ('^' || case when p_kind = 'handover_receipt' then 'receipts/' else 'rounds/' end || p_round::text || '/') then
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

create or replace function public.dispatch_log_download(p_file uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.carrier_files;
begin
  select * into f from public.carrier_files where id = p_file and deleted_at is null;
  if f.kind = 'settlement_report' then
    if not public.has_dispatch('finance') then
      raise exception 'You are not allowed to download dispatch files.' using errcode = '42501';
    end if;
  elsif not (public.has_dispatch('courier') or public.has_dispatch('plan')
             or (f.kind = 'handover_receipt' and public.has_dispatch('verify'))) then
    raise exception 'You are not allowed to download dispatch files.' using errcode = '42501';
  end if;
  if f.id is null then
    raise exception 'File not found.' using errcode = 'P0001';
  end if;
  perform public.write_activity('dispatch.file_downloaded', 'dispatch', f.id::text, null,
    'Downloaded ' || f.file_name, jsonb_build_object('kind', f.kind, 'round_id', f.round_id));
end;
$$;

drop policy if exists "dispatch bucket: finance uploads settlements" on storage.objects;
create policy "dispatch bucket: finance uploads settlements"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dispatch' and (storage.foldername(name))[1] = 'settlements' and (select public.has_dispatch('finance')));
drop policy if exists "dispatch bucket: finance reads settlements" on storage.objects;
create policy "dispatch bucket: finance reads settlements"
  on storage.objects for select to authenticated
  using (bucket_id = 'dispatch' and (storage.foldername(name))[1] = 'settlements' and (select public.has_dispatch('finance')));

-- Planners and couriers read courier files, but not settlement reports.
drop policy if exists "carrier_files: planners and courier read" on public.carrier_files;
create policy "carrier_files: planners and courier read" on public.carrier_files for select to authenticated
  using (kind <> 'settlement_report' and ((select public.has_dispatch('plan')) or (select public.has_dispatch('courier'))));
drop policy if exists "carrier_files: finance reads settlement reports" on public.carrier_files;
create policy "carrier_files: finance reads settlement reports" on public.carrier_files for select to authenticated
  using (kind = 'settlement_report' and (select public.has_dispatch('finance')));

-- -----------------------------------------------------------------------------
-- 8. Row level security and privileges
-- -----------------------------------------------------------------------------
alter table public.cod_settlements enable row level security;
alter table public.cod_settlement_lines enable row level security;
drop policy if exists "cod_settlements: finance read" on public.cod_settlements;
create policy "cod_settlements: finance read" on public.cod_settlements for select to authenticated
  using ((select public.has_dispatch('finance')));
drop policy if exists "cod_settlement_lines: finance read" on public.cod_settlement_lines;
create policy "cod_settlement_lines: finance read" on public.cod_settlement_lines for select to authenticated
  using ((select public.has_dispatch('finance')));
revoke all on table public.cod_settlements, public.cod_settlement_lines from anon, authenticated;
grant select on table public.cod_settlements, public.cod_settlement_lines to authenticated;

do $$
declare
  f text;
begin
  -- Called by signed-in users (each checks permission itself).
  foreach f in array array[
    'dispatch_cod_rows(uuid, boolean)', 'settlement_save(uuid, jsonb)', 'settlement_add_lines(uuid, jsonb)',
    'settlement_set_line(uuid, numeric, numeric)', 'settlement_remove_line(uuid)', 'settlement_attach(uuid, uuid)',
    'settlement_confirm(uuid, text)', 'settlement_cancel(uuid, text)', 'cod_writeoff_set(uuid, numeric, text)',
    'dispatch_settlements()', 'round_close_check(uuid)', 'round_close(uuid, text)', 'round_reopen(uuid, text)',
    'dispatch_report_rounds(date, date)', 'dispatch_report_people(date, date)',
    'carrier_file_record(uuid, text, text, text, text, integer, integer, jsonb)', 'dispatch_log_download(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Internal helpers: nobody calls these directly.
  foreach f in array array['dispatch_round_totals(uuid)', 'dispatch_settlement_draft(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- Retention: the server's service role only.
  foreach f in array array['dispatch_retention_run(timestamptz)', 'dispatch_retention_files(timestamptz)', 'dispatch_retention_mark_deleted(uuid[])'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
