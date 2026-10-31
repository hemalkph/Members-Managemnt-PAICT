-- =============================================================================
-- Tute dispatch: handovers to the courier, delivery states, returns, voiding
-- and replacement parcels. Safe to run more than once.
--
-- A round can have many handovers, one open at a time. Ready parcels are
-- scanned into the open handover; a parcel can be in only one live handover.
-- Confirming needs the physically counted number to equal the scanned number,
-- and moves those parcels to "handed over" (never to "delivered").
-- Delivery states are changed by hand with an attributed source and reason
-- (a Citypak status-file import is added only once a real sample exists).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.handovers (
  id             uuid primary key default gen_random_uuid(),
  round_id       uuid not null references public.dispatch_rounds (id) on delete restrict,
  state          text not null default 'open' check (state in ('open', 'confirmed', 'cancelled')),
  courier_rep    text not null default '' check (char_length(courier_rep) <= 100),
  courier_ref    text not null default '' check (char_length(courier_ref) <= 100),
  counted_count  integer check (counted_count between 0 and 5000),
  note           text not null default '' check (char_length(note) <= 300),
  receipt_file   uuid references public.carrier_files (id) on delete set null,
  opened_by      uuid references public.profiles (id) on delete set null,
  opened_at      timestamptz not null default now(),
  confirmed_by   uuid references public.profiles (id) on delete set null,
  confirmed_at   timestamptz,
  cancelled_by   uuid references public.profiles (id) on delete set null,
  cancelled_at   timestamptz,
  cancel_reason  text check (char_length(cancel_reason) <= 300)
);
create unique index if not exists handovers_one_open_per_round on public.handovers (round_id) where state = 'open';
create index if not exists handovers_round_idx on public.handovers (round_id, opened_at desc);

create table if not exists public.handover_parcels (
  id          uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  parcel_id   uuid not null references public.parcels (id) on delete cascade,
  added_by    uuid references public.profiles (id) on delete set null,
  added_at    timestamptz not null default now(),
  released_by uuid references public.profiles (id) on delete set null,
  released_at timestamptz
);
-- A parcel is in at most one live (not released) handover.
create unique index if not exists handover_parcels_live_unique on public.handover_parcels (parcel_id) where released_at is null;
create index if not exists handover_parcels_handover_idx on public.handover_parcels (handover_id);

alter table public.parcels add column if not exists handover_id uuid references public.handovers (id) on delete set null;
alter table public.parcels add column if not exists delivery_note text check (char_length(delivery_note) <= 300);

-- Receipts from the courier are stored like other courier files.
alter table public.carrier_files drop constraint if exists carrier_files_kind_check;
alter table public.carrier_files add constraint carrier_files_kind_check
  check (kind in ('citypak_template', 'manifest_export', 'tracking_sheet', 'waybill_pdf', 'status_report', 'settlement_report', 'handover_receipt'));
-- Receipts (photos or PDFs) live in their own folder, receipts/<round>/, so
-- verifiers can use them without seeing the Citypak sheets in rounds/.
alter table public.carrier_files drop constraint if exists carrier_files_storage_path_check;
alter table public.carrier_files add constraint carrier_files_storage_path_check
  check (storage_path ~ '^(rounds/[0-9a-f-]{36}|templates)/[0-9a-f-]{36}\.(xlsx|csv|pdf)$'
         or storage_path ~ '^receipts/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$');
update storage.buckets
   set allowed_mime_types = array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/pdf',
                                  'image/jpeg', 'image/png', 'image/webp']
 where id = 'dispatch';

-- -----------------------------------------------------------------------------
-- 2. Courier files: handover receipts can be added by verifiers too
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

drop policy if exists "dispatch bucket: verifiers upload receipts" on storage.objects;
create policy "dispatch bucket: verifiers upload receipts"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dispatch' and (storage.foldername(name))[1] = 'receipts'
              and ((select public.has_dispatch('verify')) or (select public.has_dispatch('courier'))));
drop policy if exists "dispatch bucket: dispatch staff read receipts" on storage.objects;
create policy "dispatch bucket: dispatch staff read receipts"
  on storage.objects for select to authenticated
  using (bucket_id = 'dispatch' and (storage.foldername(name))[1] = 'receipts'
         and ((select public.has_dispatch('verify')) or (select public.has_dispatch('courier')) or (select public.has_dispatch('plan'))));

drop policy if exists "carrier_files: verifiers read receipts" on public.carrier_files;
create policy "carrier_files: verifiers read receipts" on public.carrier_files for select to authenticated
  using (kind = 'handover_receipt' and (select public.has_dispatch('verify')));

-- Downloads: verifiers may open receipts too.
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
  if not (public.has_dispatch('courier') or public.has_dispatch('plan')
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
revoke all on function public.dispatch_log_download(uuid) from public, anon, authenticated;
grant execute on function public.dispatch_log_download(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Handovers (verify permission)
-- -----------------------------------------------------------------------------
-- Is this parcel ready to give to the courier? null = yes, else the reason.
create or replace function public.dispatch_handover_block(par public.parcels)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when par.registration_state <> 'registered' then 'It has no Citypak tracking number.'
    when par.on_hold then 'It is on hold.'
    when par.delivery_state <> 'awaiting_pickup' then 'It was already handed over.'
    when par.pack_state = 'planned' then 'It is not packed yet.'
    when par.pack_state = 'packed' and coalesce((select require_verification from public.dispatch_settings limit 1), false)
      then 'It is packed but not verified yet.'
  end;
$$;

create or replace function public.handover_open(p_round uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('verify');
  hid uuid;
begin
  if not exists (select 1 from public.dispatch_rounds where id = p_round and state in ('finalised', 'active')) then
    raise exception 'Handovers can be made only for finalised rounds.' using errcode = 'P0001';
  end if;
  select id into hid from public.handovers where round_id = p_round and state = 'open';
  if hid is not null then
    return hid; -- already open: keep using it
  end if;
  insert into public.handovers (round_id, opened_by) values (p_round, actor)
  on conflict (round_id) where state = 'open' do nothing
  returning id into hid;
  if hid is null then
    select id into hid from public.handovers where round_id = p_round and state = 'open';
  end if;
  return hid;
end;
$$;

-- Scan a parcel into the open handover. Adding is reversible (release), so a
-- scan acts directly; the counted confirmation is the authoritative step.
create or replace function public.handover_scan(p_handover uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('verify');
  h public.handovers;
  code text := left(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')), 64);
  par public.parcels;
  reason text;
  other uuid;
begin
  -- Shared lock: waits for a confirm in progress, so nothing slips in after the count.
  select * into h from public.handovers where id = p_handover for share;
  if h.id is null or h.state <> 'open' then
    raise exception 'This handover is not open.' using errcode = 'P0001';
  end if;
  if code ~ '^D[0-9]{8}$' then
    select * into par from public.parcels where tracking_no = code;
  else
    select * into par from public.parcels where reference = code;
  end if;
  if par.id is null then
    return jsonb_build_object('result', 'unknown', 'message', 'No parcel has this code.', 'code', code);
  end if;
  if par.round_id <> h.round_id then
    return jsonb_build_object('result', 'wrong_round', 'message', 'This parcel belongs to another round.', 'reference', par.reference);
  end if;

  select handover_id into other from public.handover_parcels where parcel_id = par.id and released_at is null;
  if other = h.id then
    return jsonb_build_object('result', 'duplicate', 'message', 'Already in this handover.', 'reference', par.reference);
  end if;
  reason := public.dispatch_handover_block(par);
  if reason is not null then
    return jsonb_build_object('result', 'not_ready', 'message', reason, 'reference', par.reference);
  end if;

  insert into public.handover_parcels (handover_id, parcel_id, added_by)
  values (h.id, par.id, actor)
  on conflict (parcel_id) where released_at is null do nothing;
  if not found then
    return jsonb_build_object('result', 'duplicate', 'message', 'Already in a handover.', 'reference', par.reference);
  end if;
  return jsonb_build_object('result', 'ok', 'message', 'Added ' || par.reference, 'reference', par.reference, 'parcel_id', par.id);
end;
$$;

create or replace function public.handover_release(p_handover uuid, p_parcel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('verify');
begin
  perform 1 from public.handovers where id = p_handover and state = 'open' for share;
  if not found then
    raise exception 'This handover is not open.' using errcode = 'P0001';
  end if;
  update public.handover_parcels
     set released_at = now(), released_by = actor
   where handover_id = p_handover and parcel_id = p_parcel and released_at is null;
end;
$$;

-- Confirm what the courier took. The counted number must equal the scanned number.
create or replace function public.handover_confirm(
  p_handover uuid, p_counted integer, p_courier_rep text, p_courier_ref text, p_note text, p_receipt uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('verify');
  h public.handovers;
  scanned integer;
  bad text;
  n integer;
begin
  select * into h from public.handovers where id = p_handover for update;
  if h.id is null or h.state <> 'open' then
    raise exception 'This handover is not open (it may have been confirmed already).' using errcode = 'P0001';
  end if;
  select count(*) into scanned from public.handover_parcels where handover_id = h.id and released_at is null;
  if scanned = 0 then
    raise exception 'Scan the parcels into the handover first.' using errcode = 'P0001';
  end if;
  if p_counted is null or p_counted <> scanned then
    raise exception 'You counted % but % were scanned. Find the difference before confirming.', coalesce(p_counted, 0), scanned
      using errcode = 'P0001';
  end if;
  if p_receipt is not null and not exists (select 1 from public.carrier_files where id = p_receipt and round_id = h.round_id and kind = 'handover_receipt') then
    raise exception 'Receipt file not found.' using errcode = 'P0001';
  end if;

  -- Lock the parcels, then re-check every one (one may have gone on hold since it was scanned).
  perform 1 from public.parcels p join public.handover_parcels hp on hp.parcel_id = p.id
   where hp.handover_id = h.id and hp.released_at is null order by p.id for update of p;
  select p.reference || ': ' || public.dispatch_handover_block(p) into bad
    from public.handover_parcels hp join public.parcels p on p.id = hp.parcel_id
   where hp.handover_id = h.id and hp.released_at is null and public.dispatch_handover_block(p) is not null
   order by p.reference limit 1;
  if bad is not null then
    raise exception 'Can''t confirm – %. Remove it from the handover first.', bad using errcode = 'P0001';
  end if;

  with moved as (
    update public.parcels p
       set delivery_state = 'handed_over', handover_id = h.id, row_version = p.row_version + 1, updated_at = now()
      from public.handover_parcels hp
     where hp.handover_id = h.id and hp.released_at is null and hp.parcel_id = p.id and p.delivery_state = 'awaiting_pickup'
    returning p.id, p.round_id
  )
  insert into public.parcel_events (parcel_id, round_id, type, from_state, to_state, actor, source, details)
  select id, round_id, 'handed_over', 'awaiting_pickup', 'handed_over', actor, 'manual', jsonb_build_object('handover_id', h.id)
    from moved;
  get diagnostics n = row_count;

  update public.handovers
     set state = 'confirmed', counted_count = p_counted, courier_rep = left(trim(coalesce(p_courier_rep, '')), 100),
         courier_ref = left(trim(coalesce(p_courier_ref, '')), 100), note = left(trim(coalesce(p_note, '')), 300),
         receipt_file = p_receipt, confirmed_by = actor, confirmed_at = now()
   where id = h.id;
  update public.dispatch_rounds set state = 'active', updated_by = actor, updated_at = now()
   where id = h.round_id and state = 'finalised';

  perform public.write_activity('dispatch.handover_confirmed', 'dispatch', h.id::text, null,
    'Handed ' || n || ' parcel' || case when n = 1 then '' else 's' end || ' to the courier',
    jsonb_build_object('round_id', h.round_id, 'handover_id', h.id, 'parcels', n));
  return n;
end;
$$;

create or replace function public.handover_cancel(p_handover uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('verify');
begin
  update public.handovers
     set state = 'cancelled', cancelled_by = actor, cancelled_at = now(), cancel_reason = left(trim(coalesce(p_reason, '')), 300)
   where id = p_handover and state = 'open';
  if not found then
    raise exception 'This handover is not open.' using errcode = 'P0001';
  end if;
  update public.handover_parcels set released_at = now(), released_by = actor
   where handover_id = p_handover and released_at is null;
end;
$$;

-- The round's handovers with who confirmed them and how many parcels each holds.
create or replace function public.dispatch_handover_list(p_round uuid)
returns table (
  id uuid, state text, courier_rep text, courier_ref text, counted_count integer, note text, receipt_file uuid,
  opened_at timestamptz, confirmed_at timestamptz, confirmed_name text, cancelled_at timestamptz, cancel_reason text, parcels integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_page('dispatch') then
    raise exception 'You are not allowed to see handovers.' using errcode = '42501';
  end if;
  return query
    select h.id, h.state, h.courier_rep, h.courier_ref, h.counted_count, h.note, h.receipt_file,
           h.opened_at, h.confirmed_at, public.dispatch_name(h.confirmed_by), h.cancelled_at, h.cancel_reason,
           (select count(*)::integer from public.handover_parcels hp where hp.handover_id = h.id and hp.released_at is null)
      from public.handovers h
     where h.round_id = p_round
     order by h.opened_at desc
     limit 200;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Delivery states (courier permission; attributed manual updates)
-- -----------------------------------------------------------------------------
-- Allowed moves:
--   handed_over → in_transit | delivered | failed | returned
--   in_transit  → delivered | failed | returned
--   failed      → in_transit | delivered | returned
-- Delivered and returned are final; changing them needs the correct permission.
-- Failed, returned and every correction need a reason.
create or replace function public.delivery_set(p_parcels uuid[], p_state text, p_reason text, p_evidence text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('courier');
  correcting boolean := public.has_dispatch('correct');
  par public.parcels;
  allowed boolean;
  is_correction boolean;
  changed integer := 0;
  skipped jsonb := '[]'::jsonb;
begin
  if p_state not in ('in_transit', 'delivered', 'failed', 'returned') then
    raise exception 'Unknown delivery state.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_parcels, 1), 0) = 0 or array_length(p_parcels, 1) > 5000 then
    raise exception 'Choose up to 5,000 parcels.' using errcode = 'P0001';
  end if;
  if p_state in ('failed', 'returned') and char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason for failed or returned parcels.' using errcode = 'P0001';
  end if;

  for par in select * from public.parcels where id = any (p_parcels)
                and round_id in (select id from public.dispatch_rounds where state in ('finalised', 'active'))
              order by reference for update loop
    allowed := case par.delivery_state
      when 'handed_over' then p_state in ('in_transit', 'delivered', 'failed', 'returned')
      when 'in_transit' then p_state in ('delivered', 'failed', 'returned')
      when 'failed' then p_state in ('in_transit', 'delivered', 'returned')
      else false
    end;
    is_correction := not allowed and par.delivery_state in ('delivered', 'returned') and par.delivery_state <> p_state;
    if par.registration_state = 'voided' or par.delivery_state = p_state
       or (not allowed and not (is_correction and correcting and char_length(trim(coalesce(p_reason, ''))) >= 3)) then
      skipped := skipped || jsonb_build_object('reference', par.reference, 'state', par.delivery_state);
      continue;
    end if;
    update public.parcels
       set delivery_state = p_state, delivery_note = nullif(left(trim(coalesce(p_evidence, '')), 300), ''),
           row_version = row_version + 1, updated_at = now()
     where id = par.id;
    insert into public.parcel_events (parcel_id, round_id, type, from_state, to_state, actor, source, reason, details)
    values (par.id, par.round_id, case when is_correction then 'delivery_corrected' else 'delivery' end,
            par.delivery_state, p_state, actor, 'manual', nullif(left(trim(coalesce(p_reason, '')), 300), ''),
            jsonb_build_object('evidence', nullif(left(trim(coalesce(p_evidence, '')), 300), '')));
    changed := changed + 1;
  end loop;
  return jsonb_build_object('changed', changed, 'skipped', skipped);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Void and replacement (correct permission)
-- -----------------------------------------------------------------------------
-- Void a parcel (after voiding it with Citypak if it was registered). Allowed
-- before handover, or after it failed or came back.
create or replace function public.parcel_void(p_parcel uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('correct');
  par public.parcels;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason.' using errcode = 'P0001';
  end if;
  select * into par from public.parcels where id = p_parcel for update;
  if par.id is null then
    raise exception 'Parcel not found.' using errcode = 'P0001';
  end if;
  if par.registration_state = 'voided' then
    raise exception 'This parcel is already voided.' using errcode = 'P0001';
  end if;
  if par.delivery_state not in ('awaiting_pickup', 'failed', 'returned') then
    raise exception 'A parcel with the courier can be voided only after it failed or came back.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.handover_parcels where parcel_id = par.id and released_at is null
             and handover_id in (select id from public.handovers where state = 'open')) then
    raise exception 'Remove it from the open handover first.' using errcode = 'P0001';
  end if;

  update public.parcels set registration_state = 'voided', row_version = row_version + 1, updated_at = now() where id = par.id;
  update public.parcel_exceptions
     set resolution = 'void', resolution_note = left(trim(p_reason), 300), resolved_by = actor, resolved_at = now()
   where parcel_id = par.id and resolved_at is null;
  insert into public.parcel_events (parcel_id, round_id, type, from_state, to_state, actor, source, reason)
  values (par.id, par.round_id, 'voided', par.registration_state, 'voided', actor, 'manual', left(trim(p_reason), 300));
end;
$$;

-- Send again: voids the parcel if needed and creates a replacement with a new
-- reference (original + R1, R2 …). p: {recipient?: {...}, cod_expected?, tute_ids?}.
create or replace function public.parcel_replace(p_parcel uuid, p_reason text, p jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('correct');
  par public.parcels;
  base text;
  n integer := 1;
  ref text;
  new_id uuid;
  tids uuid[];
begin
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason.' using errcode = 'P0001';
  end if;
  select * into par from public.parcels where id = p_parcel for update;
  if par.id is null then
    raise exception 'Parcel not found.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.dispatch_rounds where id = par.round_id and state in ('finalised', 'active')) then
    raise exception 'The round is not open.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.parcels where replaces_parcel_id = par.id) then
    raise exception 'This parcel was already replaced.' using errcode = 'P0001';
  end if;
  -- Close its open problems as "sent again" before voiding it.
  update public.parcel_exceptions
     set resolution = 'reship', resolution_note = left(trim(p_reason), 300), resolved_by = actor, resolved_at = now()
   where parcel_id = par.id and resolved_at is null;
  if par.registration_state <> 'voided' then
    perform public.parcel_void(par.id, p_reason);
  end if;

  -- The new reference: the first parcel's reference plus R and the next free number.
  with recursive chain as (
    select id, reference, replaces_parcel_id, 0 as depth from public.parcels where id = par.id
    union all
    select p.id, p.reference, p.replaces_parcel_id, c.depth + 1 from public.parcels p join chain c on p.id = c.replaces_parcel_id
     where c.depth < 50
  )
  select reference into base from chain order by depth desc limit 1;
  loop
    ref := base || 'R' || n;
    exit when not exists (select 1 from public.parcels where reference = ref);
    n := n + 1;
  end loop;
  if char_length(ref) > 40 then
    raise exception 'The replacement reference would be too long.' using errcode = 'P0001';
  end if;

  insert into public.parcels (round_id, student_id, reference, replaces_parcel_id, cod_expected, weight_g, pieces, manifest_version)
  values (par.round_id, par.student_id, ref, par.id,
          coalesce((p ->> 'cod_expected')::numeric, par.cod_expected), par.weight_g, par.pieces,
          (select manifest_version from public.dispatch_rounds where id = par.round_id))
  returning id into new_id;

  insert into public.parcel_recipients (parcel_id, name, address_line1, address_line2, address_line3, city, phone1, phone2)
  select new_id,
         coalesce(nullif(trim(p #>> '{recipient,name}'), ''), r.name),
         coalesce(nullif(trim(p #>> '{recipient,address_line1}'), ''), r.address_line1),
         case when p ? 'recipient' then coalesce(trim(p #>> '{recipient,address_line2}'), '') else r.address_line2 end,
         case when p ? 'recipient' then coalesce(trim(p #>> '{recipient,address_line3}'), '') else r.address_line3 end,
         coalesce(nullif(trim(p #>> '{recipient,city}'), ''), r.city),
         coalesce(nullif(trim(p #>> '{recipient,phone1}'), ''), r.phone1),
         case when p ? 'recipient' then nullif(trim(p #>> '{recipient,phone2}'), '') else r.phone2 end
    from public.parcel_recipients r where r.parcel_id = par.id;

  if p ? 'tute_ids' then
    tids := array(select (x #>> '{}')::uuid from jsonb_array_elements(p -> 'tute_ids') as x);
    if coalesce(array_length(tids, 1), 0) = 0
       or exists (select 1 from unnest(tids) t where not exists (select 1 from public.round_tutes rt where rt.id = t and rt.round_id = par.round_id)) then
      raise exception 'Choose the tutes for the new parcel.' using errcode = 'P0001';
    end if;
    insert into public.parcel_items (parcel_id, round_tute_id, qty)
    select new_id, rt.id, rt.qty_per_parcel from public.round_tutes rt where rt.id = any (tids);
  else
    insert into public.parcel_items (parcel_id, round_tute_id, qty)
    select new_id, round_tute_id, qty from public.parcel_items where parcel_id = par.id;
  end if;

  insert into public.parcel_events (parcel_id, round_id, type, actor, source, reason, details)
  values (par.id, par.round_id, 'replaced', actor, 'manual', left(trim(p_reason), 300), jsonb_build_object('replacement', ref)),
         (new_id, par.round_id, 'created', actor, 'manual', left(trim(p_reason), 300), jsonb_build_object('replaces', par.reference));
  perform public.write_activity('dispatch.parcel_replaced', 'dispatch', new_id::text, null,
    'Replaced parcel ' || par.reference || ' with ' || ref, jsonb_build_object('round_id', par.round_id));
  return new_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Row level security and privileges
-- -----------------------------------------------------------------------------
alter table public.handovers enable row level security;
alter table public.handover_parcels enable row level security;

drop policy if exists "handovers: dispatch users read" on public.handovers;
create policy "handovers: dispatch users read" on public.handovers for select to authenticated
  using ((select public.has_page('dispatch')));
drop policy if exists "handover_parcels: dispatch users read" on public.handover_parcels;
create policy "handover_parcels: dispatch users read" on public.handover_parcels for select to authenticated
  using ((select public.has_page('dispatch')));

revoke all on table public.handovers, public.handover_parcels from anon, authenticated;
grant select on table public.handovers, public.handover_parcels to authenticated;

revoke all on function public.carrier_file_record(uuid, text, text, text, text, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.dispatch_handover_block(public.parcels) from public, anon, authenticated;
revoke all on function public.handover_open(uuid) from public, anon, authenticated;
revoke all on function public.handover_scan(uuid, text) from public, anon, authenticated;
revoke all on function public.handover_release(uuid, uuid) from public, anon, authenticated;
revoke all on function public.handover_confirm(uuid, integer, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.handover_cancel(uuid, text) from public, anon, authenticated;
revoke all on function public.dispatch_handover_list(uuid) from public, anon, authenticated;
revoke all on function public.delivery_set(uuid[], text, text, text) from public, anon, authenticated;
revoke all on function public.parcel_void(uuid, text) from public, anon, authenticated;
revoke all on function public.parcel_replace(uuid, text, jsonb) from public, anon, authenticated;

grant execute on function public.carrier_file_record(uuid, text, text, text, text, integer, integer, jsonb) to authenticated;
grant execute on function public.handover_open(uuid) to authenticated;
grant execute on function public.handover_scan(uuid, text) to authenticated;
grant execute on function public.handover_release(uuid, uuid) to authenticated;
grant execute on function public.handover_confirm(uuid, integer, text, text, text, uuid) to authenticated;
grant execute on function public.handover_cancel(uuid, text) to authenticated;
grant execute on function public.dispatch_handover_list(uuid) to authenticated;
grant execute on function public.delivery_set(uuid[], text, text, text) to authenticated;
grant execute on function public.parcel_void(uuid, text) to authenticated;
grant execute on function public.parcel_replace(uuid, text, jsonb) to authenticated;
