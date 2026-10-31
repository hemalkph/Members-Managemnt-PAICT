-- =============================================================================
-- Tute dispatch: packing station. Safe to run more than once.
--
-- Packers scan a Citypak label (tracking number or our reference), check the
-- tutes, then confirm. Confirming is idempotent: the browser sends one key
-- per opened parcel card, and a repeated key returns the first answer. Two
-- people confirming the same parcel get one success and one "already packed".
-- A second person can verify packed parcels. Problems put a parcel on hold.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.parcel_exceptions (
  id              uuid primary key default gen_random_uuid(),
  parcel_id       uuid not null references public.parcels (id) on delete cascade,
  round_id        uuid not null references public.dispatch_rounds (id) on delete cascade,
  kind            text not null check (kind in ('missing_item', 'damaged', 'wrong_address', 'label_problem', 'returned', 'cod_issue', 'other')),
  note            text not null default '' check (char_length(note) <= 300),
  opened_by       uuid references public.profiles (id) on delete set null,
  opened_at       timestamptz not null default now(),
  resolution      text check (resolution in ('fixed', 'reship', 'void', 'write_off')),
  resolution_note text check (char_length(resolution_note) <= 300),
  resolved_by     uuid references public.profiles (id) on delete set null,
  resolved_at     timestamptz,
  check ((resolution is null) = (resolved_at is null))
);
create index if not exists parcel_exceptions_open_idx on public.parcel_exceptions (parcel_id) where resolved_at is null;
create index if not exists parcel_exceptions_round_idx on public.parcel_exceptions (round_id, opened_at desc);

-- Every scan attempt that changed something or failed. Lookups that simply
-- found a ready parcel are not stored.
create table if not exists public.parcel_scans (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key uuid unique,
  round_id        uuid not null references public.dispatch_rounds (id) on delete cascade,
  parcel_id       uuid references public.parcels (id) on delete set null,
  raw_code        text check (char_length(raw_code) <= 64),
  action          text not null check (action in ('lookup', 'pack', 'verify')),
  result          text not null check (char_length(result) <= 30),
  response        jsonb not null default '{}'::jsonb,
  operator        uuid references public.profiles (id) on delete set null,
  device_id       text check (char_length(device_id) <= 64),
  event_id        bigint references public.parcel_events (id),
  created_at      timestamptz not null default now()
);
create index if not exists parcel_scans_round_idx on public.parcel_scans (round_id, created_at desc);

-- Keep parcels.on_hold in step with open exceptions.
create or replace function public.sync_parcel_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.parcels p
     set on_hold = exists (select 1 from public.parcel_exceptions e where e.parcel_id = p.id and e.resolved_at is null),
         row_version = p.row_version + 1,
         updated_at = now()
   where p.id = new.parcel_id;
  return null;
end;
$$;

create or replace trigger parcel_exceptions_sync_hold
  after insert or update of resolved_at on public.parcel_exceptions
  for each row execute function public.sync_parcel_hold();

-- -----------------------------------------------------------------------------
-- 2. Helpers (internal)
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) from public.profiles where id = p_user;
$$;

-- Can this person pack (dispatch edit access plus the pack permission)?
create or replace function public.dispatch_can_pack(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user and p.is_active
      and (
        (p.is_admin and p.is_main_admin)
        or (p.is_admin and coalesce(p.page_access ->> 'dispatch', 'edit') = 'edit')
        or (not p.is_admin and p.page_access ->> 'dispatch' = 'edit'
            and exists (select 1 from public.dispatch_grants g
                        where g.user_id = p.id and g.capability = 'pack' and g.revoked_at is null))
      )
  );
$$;

-- What a packer may see about a parcel: no address or phone.
create or replace function public.dispatch_parcel_card(p_parcel uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'round_id', p.round_id,
    'reference', p.reference,
    'tracking_no', p.tracking_no,
    'student_no', s.student_no,
    'cod', p.cod_expected,
    'registration_state', p.registration_state,
    'pack_state', p.pack_state,
    'delivery_state', p.delivery_state,
    'on_hold', p.on_hold,
    'row_version', p.row_version,
    'assigned_to', p.assigned_to,
    'assigned_name', public.dispatch_name(p.assigned_to),
    'packed_by', p.packed_by,
    'packed_name', public.dispatch_name(p.packed_by),
    'packed_at', p.packed_at,
    'verified_name', public.dispatch_name(p.verified_by),
    'verified_at', p.verified_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'code', t.short_code, 'title', t.title, 'qty', i.qty) order by t.sort_order)
      from public.parcel_items i join public.round_tutes t on t.id = i.round_tute_id
      where i.parcel_id = p.id), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'note', e.note) order by e.opened_at)
      from public.parcel_exceptions e where e.parcel_id = p.id and e.resolved_at is null), '[]'::jsonb)
  )
  from public.parcels p join public.students s on s.id = p.student_id
  where p.id = p_parcel;
$$;

-- Why a parcel can't be packed or verified right now (null = it can).
create or replace function public.dispatch_block_reason(par public.parcels, p_action text, p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  hold text;
begin
  if par.registration_state = 'voided' then
    return jsonb_build_object('result', 'blocked', 'message', 'This parcel was voided.');
  end if;
  if par.delivery_state <> 'awaiting_pickup' then
    return jsonb_build_object('result', 'blocked', 'message', 'Already handed to the courier – packing can''t change.');
  end if;
  if par.on_hold then
    select string_agg(replace(kind, '_', ' '), ', ') into hold
      from public.parcel_exceptions where parcel_id = par.id and resolved_at is null;
    return jsonb_build_object('result', 'not_ready', 'message', 'On hold: ' || coalesce(hold, 'problem reported'));
  end if;

  if p_action = 'pack' then
    if par.registration_state <> 'registered' then
      return jsonb_build_object('result', 'not_ready', 'message', 'No Citypak tracking number yet.');
    end if;
    if par.pack_state <> 'planned' then
      return jsonb_build_object('result', 'duplicate',
        'message', 'Already packed by ' || coalesce(public.dispatch_name(par.packed_by), 'someone')
                   || ' at ' || to_char(par.packed_at at time zone 'Asia/Colombo', 'HH24:MI, DD Mon'));
    end if;
    if par.assigned_to is not null and par.assigned_to <> p_actor and not public.has_dispatch('plan') then
      return jsonb_build_object('result', 'not_assigned',
        'message', 'Assigned to ' || coalesce(public.dispatch_name(par.assigned_to), 'another packer') || '.');
    end if;
  else
    if not coalesce((select require_verification from public.dispatch_settings limit 1), false) then
      return jsonb_build_object('result', 'blocked', 'message', 'Verification is switched off in settings.');
    end if;
    if par.pack_state = 'planned' then
      return jsonb_build_object('result', 'not_ready', 'message', 'Not packed yet.');
    end if;
    if par.pack_state = 'verified' then
      return jsonb_build_object('result', 'duplicate',
        'message', 'Already verified by ' || coalesce(public.dispatch_name(par.verified_by), 'someone')
                   || ' at ' || to_char(par.verified_at at time zone 'Asia/Colombo', 'HH24:MI, DD Mon'));
    end if;
    if par.packed_by = p_actor then
      return jsonb_build_object('result', 'blocked', 'message', 'You packed this parcel – someone else must verify it.');
    end if;
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Scanning
-- -----------------------------------------------------------------------------
-- Look a scanned code up. Changes nothing (failed lookups are recorded).
create or replace function public.scan_lookup(p_round uuid, p_code text, p_action text, p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  code text := left(upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')), 64);
  par public.parcels;
  blocked jsonb;
  other_round text;
begin
  if p_action not in ('pack', 'verify') then
    raise exception 'Unknown scan mode.' using errcode = 'P0001';
  end if;
  actor := public.dispatch_require(p_action);
  if not exists (select 1 from public.dispatch_rounds where id = p_round) then
    raise exception 'Round not found.' using errcode = 'P0001';
  end if;

  if code ~ '^D[0-9]{8}$' then
    select * into par from public.parcels where tracking_no = code;
  else
    select * into par from public.parcels where reference = code;
  end if;

  if par.id is null then
    insert into public.parcel_scans (round_id, raw_code, action, result, operator, device_id)
    values (p_round, code, 'lookup', 'unknown', actor, left(p_device, 64));
    return jsonb_build_object('result', 'unknown', 'message', 'No parcel has this code.', 'code', code);
  end if;
  if par.round_id <> p_round then
    select name into other_round from public.dispatch_rounds where id = par.round_id;
    insert into public.parcel_scans (round_id, parcel_id, raw_code, action, result, operator, device_id)
    values (p_round, par.id, code, 'lookup', 'wrong_round', actor, left(p_device, 64));
    return jsonb_build_object('result', 'wrong_round', 'message', 'This parcel belongs to round “' || other_round || '”.', 'code', code);
  end if;

  blocked := public.dispatch_block_reason(par, p_action, actor);
  if blocked is not null then
    insert into public.parcel_scans (round_id, parcel_id, raw_code, action, result, operator, device_id)
    values (p_round, par.id, code, 'lookup', blocked ->> 'result', actor, left(p_device, 64));
    return blocked || jsonb_build_object('card', public.dispatch_parcel_card(par.id), 'code', code);
  end if;
  return jsonb_build_object('result', 'ready', 'card', public.dispatch_parcel_card(par.id), 'code', code);
end;
$$;

-- Confirm a parcel as packed (p_action 'pack') or verified ('verify').
-- p_checked must be exactly the parcel's tutes. Never raises for an ordinary
-- refusal: the answer is stored under p_idem so a retry gets the same answer.
create or replace function public.parcel_scan_confirm(
  p_parcel uuid, p_action text, p_idem uuid, p_row_version integer, p_checked uuid[], p_device text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  par public.parcels;
  previous jsonb;
  answer jsonb;
  ev bigint;
  wanted uuid[];
begin
  if p_action not in ('pack', 'verify') then
    raise exception 'Unknown scan mode.' using errcode = 'P0001';
  end if;
  actor := public.dispatch_require(p_action);
  if p_idem is null then
    raise exception 'Missing request key.' using errcode = 'P0001';
  end if;

  -- One request key at a time; a repeat returns the stored answer.
  perform pg_advisory_xact_lock(hashtextextended('parcel-scan:' || p_idem::text, 0));
  select ps.response into previous from public.parcel_scans ps where ps.idempotency_key = p_idem;
  if previous is not null then
    return previous || jsonb_build_object('replayed', true);
  end if;

  select * into par from public.parcels where id = p_parcel for update;
  if par.id is null then
    raise exception 'Parcel not found.' using errcode = 'P0001';
  end if;

  answer := public.dispatch_block_reason(par, p_action, actor);
  if answer is null and par.row_version <> p_row_version then
    answer := jsonb_build_object('result', 'changed', 'message', 'This parcel changed since you scanned it. Scan it again.');
  end if;
  if answer is null then
    select coalesce(array_agg(round_tute_id order by round_tute_id), '{}') into wanted
      from public.parcel_items where parcel_id = par.id;
    if wanted <> coalesce((select array_agg(x order by x) from (select distinct unnest(p_checked) as x) d), '{}') then
      answer := jsonb_build_object('result', 'items', 'message', 'Tick every tute in the parcel before confirming.');
    end if;
  end if;

  if answer is null then
    if p_action = 'pack' then
      update public.parcels
         set pack_state = 'packed', packed_by = actor, packed_at = now(), row_version = row_version + 1, updated_at = now()
       where id = par.id and pack_state = 'planned';
    else
      update public.parcels
         set pack_state = 'verified', verified_by = actor, verified_at = now(), row_version = row_version + 1, updated_at = now()
       where id = par.id and pack_state = 'packed';
    end if;
    insert into public.parcel_events (parcel_id, round_id, type, from_state, to_state, actor, source, details)
    values (par.id, par.round_id, case when p_action = 'pack' then 'packed' else 'verified' end,
            par.pack_state, case when p_action = 'pack' then 'packed' else 'verified' end, actor, 'scan',
            jsonb_build_object('device', left(p_device, 64)))
    returning id into ev;
    answer := jsonb_build_object('result', 'ok',
      'message', case when p_action = 'pack' then 'Packed' else 'Verified' end || ' ' || par.reference,
      'by', public.dispatch_name(actor), 'at', now());
  end if;

  answer := answer || jsonb_build_object('reference', par.reference, 'parcel_id', par.id);
  insert into public.parcel_scans (idempotency_key, round_id, parcel_id, action, result, response, operator, device_id, event_id)
  values (p_idem, par.round_id, par.id, p_action, answer ->> 'result', answer, actor, left(p_device, 64), ev);
  return answer;
end;
$$;

-- Undo packing before handover (correct permission, reason required).
create or replace function public.parcel_unpack(p_parcel uuid, p_reason text, p_row_version integer)
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
  if par.id is null or par.pack_state = 'planned' then
    raise exception 'This parcel is not packed.' using errcode = 'P0001';
  end if;
  if par.delivery_state <> 'awaiting_pickup' then
    raise exception 'Already handed to the courier.' using errcode = 'P0001';
  end if;
  if par.row_version <> p_row_version then
    raise exception 'This parcel was changed by someone else. Reload and try again.' using errcode = 'P0001';
  end if;
  update public.parcels
     set pack_state = 'planned', packed_by = null, packed_at = null, verified_by = null, verified_at = null,
         row_version = row_version + 1, updated_at = now()
   where id = par.id;
  insert into public.parcel_events (parcel_id, round_id, type, from_state, to_state, actor, source, reason)
  values (par.id, par.round_id, 'unpacked', par.pack_state, 'planned', actor, 'manual', left(trim(p_reason), 300));
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Exceptions (problems) and assignment
-- -----------------------------------------------------------------------------
create or replace function public.exception_open(p_parcel uuid, p_kind text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  par public.parcels;
  eid uuid;
begin
  if not (public.has_dispatch('pack') or public.has_dispatch('verify') or public.has_dispatch('plan')) then
    raise exception 'You are not allowed to report parcel problems.' using errcode = '42501';
  end if;
  select * into par from public.parcels where id = p_parcel;
  if par.id is null or par.registration_state = 'voided' then
    raise exception 'Parcel not found.' using errcode = 'P0001';
  end if;
  insert into public.parcel_exceptions (parcel_id, round_id, kind, note, opened_by)
  values (par.id, par.round_id, p_kind, left(trim(coalesce(p_note, '')), 300), actor)
  returning id into eid;
  insert into public.parcel_events (parcel_id, round_id, type, actor, source, reason, details)
  values (par.id, par.round_id, 'problem_reported', actor, 'manual', left(trim(coalesce(p_note, '')), 300),
          jsonb_build_object('kind', p_kind, 'exception_id', eid));
  return eid;
end;
$$;

-- Resolve a problem. This version handles "fixed"; reshipping and voiding come with returns.
create or replace function public.exception_resolve(p_exception uuid, p_resolution text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
  e public.parcel_exceptions;
begin
  if p_resolution <> 'fixed' then
    raise exception 'Only "fixed" can be chosen for now; reship and void come with returns.' using errcode = 'P0001';
  end if;
  select * into e from public.parcel_exceptions where id = p_exception for update;
  if e.id is null or e.resolved_at is not null then
    raise exception 'This problem is already resolved.' using errcode = 'P0001';
  end if;
  update public.parcel_exceptions
     set resolution = p_resolution, resolution_note = left(trim(coalesce(p_note, '')), 300), resolved_by = actor, resolved_at = now()
   where id = e.id;
  insert into public.parcel_events (parcel_id, round_id, type, actor, source, reason, details)
  values (e.parcel_id, e.round_id, 'problem_resolved', actor, 'manual', left(trim(coalesce(p_note, '')), 300),
          jsonb_build_object('resolution', p_resolution, 'exception_id', e.id));
end;
$$;

-- Assign parcels to a packer (null = unassign). Only parcels not yet packed.
create or replace function public.parcel_assign(p_round uuid, p_parcels uuid[], p_packer uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
  n integer;
begin
  if coalesce(array_length(p_parcels, 1), 0) > 5000 then
    raise exception 'Too many parcels.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.dispatch_rounds where id = p_round and state in ('finalised', 'active')) then
    raise exception 'Parcels can be assigned only in finalised rounds.' using errcode = 'P0001';
  end if;
  if p_packer is not null and not public.dispatch_can_pack(p_packer) then
    raise exception 'This person can''t pack (they need Tute dispatch edit access and the Pack permission).' using errcode = 'P0001';
  end if;

  with changed as (
    update public.parcels p
       set assigned_to = p_packer, row_version = p.row_version + 1, updated_at = now()
     where p.round_id = p_round and p.id = any (p_parcels) and p.pack_state = 'planned'
       and p.registration_state <> 'voided' and p.assigned_to is distinct from p_packer
    returning p.id, p.round_id
  )
  insert into public.parcel_events (parcel_id, round_id, type, actor, source, details)
  select id, round_id, 'assigned', actor, 'manual', jsonb_build_object('packer', p_packer) from changed;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- People who can be given packing work (plan only).
create or replace function public.dispatch_packers()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.dispatch_name(p.id)
  from public.profiles p
  where public.has_dispatch('plan') and public.dispatch_can_pack(p.id)
  order by 2;
$$;

-- The packing list: no addresses. Packers without plan/verify see their own parcels and unassigned ones.
create or replace function public.dispatch_pack_list(p_round uuid)
returns table (
  parcel_id uuid, reference text, tracking_no text, student_no text, items text, pack_state text, on_hold boolean,
  registration_state text, assigned_to uuid, assigned_name text, packed_name text, packed_at timestamptz,
  verified_name text, verified_at timestamptz, row_version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  everyone boolean := public.has_dispatch('plan') or public.has_dispatch('verify');
begin
  if not (everyone or public.has_dispatch('pack')) then
    raise exception 'You are not allowed to see the packing list.' using errcode = '42501';
  end if;
  return query
    select p.id, p.reference, p.tracking_no, s.student_no,
           (select string_agg(t.short_code || case when i.qty > 1 then '×' || i.qty else '' end, ' ' order by t.sort_order)
              from public.parcel_items i join public.round_tutes t on t.id = i.round_tute_id where i.parcel_id = p.id),
           p.pack_state, p.on_hold, p.registration_state, p.assigned_to, public.dispatch_name(p.assigned_to),
           public.dispatch_name(p.packed_by), p.packed_at, public.dispatch_name(p.verified_by), p.verified_at, p.row_version
      from public.parcels p join public.students s on s.id = p.student_id
     where p.round_id = p_round and p.registration_state <> 'voided'
       and (everyone or p.assigned_to is null or p.assigned_to = actor)
     order by p.reference;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Live progress: parcels in the Realtime publication (no personal data)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'parcels') then
    alter publication supabase_realtime add table public.parcels;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Row level security and privileges
-- -----------------------------------------------------------------------------
alter table public.parcel_exceptions enable row level security;
alter table public.parcel_scans enable row level security;

drop policy if exists "parcel_exceptions: dispatch workers read" on public.parcel_exceptions;
create policy "parcel_exceptions: dispatch workers read" on public.parcel_exceptions for select to authenticated
  using ((select public.has_dispatch('plan')) or (select public.has_dispatch('pack'))
         or (select public.has_dispatch('verify')) or (select public.has_dispatch('courier')));

drop policy if exists "parcel_scans: planners read" on public.parcel_scans;
create policy "parcel_scans: planners read" on public.parcel_scans for select to authenticated
  using ((select public.has_dispatch('plan')));

revoke all on table public.parcel_exceptions, public.parcel_scans from anon, authenticated;
grant select on table public.parcel_exceptions, public.parcel_scans to authenticated;

revoke all on function public.sync_parcel_hold() from public, anon, authenticated;
revoke all on function public.dispatch_name(uuid) from public, anon, authenticated;
revoke all on function public.dispatch_can_pack(uuid) from public, anon, authenticated;
revoke all on function public.dispatch_parcel_card(uuid) from public, anon, authenticated;
revoke all on function public.dispatch_block_reason(public.parcels, text, uuid) from public, anon, authenticated;
revoke all on function public.scan_lookup(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.parcel_scan_confirm(uuid, text, uuid, integer, uuid[], text) from public, anon, authenticated;
revoke all on function public.parcel_unpack(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.exception_open(uuid, text, text) from public, anon, authenticated;
revoke all on function public.exception_resolve(uuid, text, text) from public, anon, authenticated;
revoke all on function public.parcel_assign(uuid, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.dispatch_packers() from public, anon, authenticated;
revoke all on function public.dispatch_pack_list(uuid) from public, anon, authenticated;

grant execute on function public.scan_lookup(uuid, text, text, text) to authenticated;
grant execute on function public.parcel_scan_confirm(uuid, text, uuid, integer, uuid[], text) to authenticated;
grant execute on function public.parcel_unpack(uuid, text, integer) to authenticated;
grant execute on function public.exception_open(uuid, text, text) to authenticated;
grant execute on function public.exception_resolve(uuid, text, text) to authenticated;
grant execute on function public.parcel_assign(uuid, uuid[], uuid) to authenticated;
grant execute on function public.dispatch_packers() to authenticated;
grant execute on function public.dispatch_pack_list(uuid) to authenticated;
