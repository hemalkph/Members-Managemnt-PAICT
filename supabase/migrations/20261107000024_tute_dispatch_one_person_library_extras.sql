-- =============================================================================
-- Tute dispatch: one-person mode, saved tutes and extra tutes. Safe to run more than once.
--
-- 1. One-person mode (setting allow_self_verify): the packer may also verify
--    their own parcels. Both scans still happen, so a second person can take
--    over verifying later just by switching the setting off.
-- 2. Saved tutes (dispatch_tutes): tutes added ahead of time and picked when
--    planning a round. The round keeps its own copy, so editing a saved tute
--    never changes a round.
-- 3. Extra tutes: a round tute marked is_extra goes only to the students who
--    have it in round_students.extra_tute_ids (normal tutes go to everyone
--    unless excluded, as before).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columns and tables
-- -----------------------------------------------------------------------------
alter table public.dispatch_settings add column if not exists allow_self_verify boolean not null default false;
alter table public.round_tutes add column if not exists is_extra boolean not null default false;
alter table public.round_students add column if not exists extra_tute_ids uuid[] not null default '{}';

create table if not exists public.dispatch_tutes (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (char_length(trim(title)) between 1 and 150),
  short_code     text not null check (short_code ~ '^[A-Z0-9-]{1,10}$'),
  version_label  text not null default '' check (char_length(version_label) <= 30),
  qty_per_parcel integer not null default 1 check (qty_per_parcel between 1 and 10),
  archived_at    timestamptz,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now()
);
create unique index if not exists dispatch_tutes_code_unique on public.dispatch_tutes (short_code) where archived_at is null;

-- -----------------------------------------------------------------------------
-- 2. Settings: allow_self_verify is a policy, so main admins only (like verification)
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_settings_save(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.dispatch_settings;
begin
  if not public.has_dispatch('plan') then
    raise exception 'You are not allowed to change dispatch settings.' using errcode = '42501';
  end if;
  select * into cur from public.dispatch_settings where id for update;

  if ((p ? 'require_verification') and (p ->> 'require_verification')::boolean is distinct from cur.require_verification)
     or ((p ? 'allow_self_verify') and (p ->> 'allow_self_verify')::boolean is distinct from cur.allow_self_verify)
     or ((p ? 'student_retention_months') and (p ->> 'student_retention_months')::integer is distinct from cur.student_retention_months)
     or ((p ? 'recipient_retention_days') and (p ->> 'recipient_retention_days')::integer is distinct from cur.recipient_retention_days)
     or ((p ? 'courier_file_retention_days') and (p ->> 'courier_file_retention_days')::integer is distinct from cur.courier_file_retention_days)
     or ((p ? 'import_file_retention_days') and (p ->> 'import_file_retention_days')::integer is distinct from cur.import_file_retention_days) then
    if not public.is_main_admin() then
      raise exception 'Only main admins can change verification or retention.' using errcode = '42501';
    end if;
  end if;

  update public.dispatch_settings set
    sender_name                 = coalesce(trim(p ->> 'sender_name'), sender_name),
    sender_line1                = coalesce(trim(p ->> 'sender_line1'), sender_line1),
    sender_line2                = coalesce(trim(p ->> 'sender_line2'), sender_line2),
    sender_line3                = coalesce(trim(p ->> 'sender_line3'), sender_line3),
    sender_city                 = coalesce(trim(p ->> 'sender_city'), sender_city),
    sender_contact_name         = coalesce(trim(p ->> 'sender_contact_name'), sender_contact_name),
    sender_phone1               = coalesce(trim(p ->> 'sender_phone1'), sender_phone1),
    sender_phone2               = coalesce(trim(p ->> 'sender_phone2'), sender_phone2),
    default_cod                 = coalesce((p ->> 'default_cod')::numeric, default_cod),
    default_weight_g            = coalesce((p ->> 'default_weight_g')::integer, default_weight_g),
    default_pieces              = coalesce((p ->> 'default_pieces')::integer, default_pieces),
    require_verification        = coalesce((p ->> 'require_verification')::boolean, require_verification),
    allow_self_verify           = coalesce((p ->> 'allow_self_verify')::boolean, allow_self_verify),
    student_retention_months    = coalesce((p ->> 'student_retention_months')::integer, student_retention_months),
    recipient_retention_days    = coalesce((p ->> 'recipient_retention_days')::integer, recipient_retention_days),
    courier_file_retention_days = coalesce((p ->> 'courier_file_retention_days')::integer, courier_file_retention_days),
    import_file_retention_days  = coalesce((p ->> 'import_file_retention_days')::integer, import_file_retention_days),
    updated_by = (select auth.uid()),
    updated_at = now()
  where id;

  perform public.write_activity('dispatch.settings_saved', 'dispatch', null, null,
    'Changed the tute dispatch settings', '{}'::jsonb);
end;
$$;

-- Same as migration 020, except a packer may verify their own parcel in one-person mode.
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
    if par.packed_by = p_actor
       and not coalesce((select allow_self_verify from public.dispatch_settings limit 1), false) then
      return jsonb_build_object('result', 'blocked', 'message', 'You packed this parcel – someone else must verify it.');
    end if;
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Saved tutes (plan capability)
-- -----------------------------------------------------------------------------
-- p: {id?, title, short_code, version_label?, qty_per_parcel?}
create or replace function public.dispatch_tute_save(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
  tid uuid := nullif(p ->> 'id', '')::uuid;
  code text := upper(trim(coalesce(p ->> 'short_code', '')));
begin
  if exists (select 1 from public.dispatch_tutes
              where short_code = code and archived_at is null and id is distinct from tid) then
    raise exception 'Another saved tute already uses the code %.', code using errcode = 'P0001';
  end if;
  if tid is null then
    insert into public.dispatch_tutes (title, short_code, version_label, qty_per_parcel, created_by, updated_by)
    values (trim(p ->> 'title'), code, coalesce(trim(p ->> 'version_label'), ''),
            coalesce((p ->> 'qty_per_parcel')::integer, 1), actor, actor)
    returning id into tid;
  else
    update public.dispatch_tutes set
      title = trim(p ->> 'title'),
      short_code = code,
      version_label = coalesce(trim(p ->> 'version_label'), ''),
      qty_per_parcel = coalesce((p ->> 'qty_per_parcel')::integer, 1),
      updated_by = actor,
      updated_at = now()
    where id = tid and archived_at is null;
    if not found then
      raise exception 'Saved tute not found.' using errcode = 'P0001';
    end if;
  end if;
  return tid;
end;
$$;

-- Archive (hide) a saved tute. Rounds keep their own copy, so nothing else changes.
create or replace function public.dispatch_tute_archive(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('plan');
begin
  update public.dispatch_tutes set archived_at = now(), updated_by = actor, updated_at = now()
   where id = p_id and archived_at is null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Planning with extra tutes (same as migration 019, plus is_extra / extra_tute_ids)
-- -----------------------------------------------------------------------------
-- Each tute: {id?, paper_id? | manual_title?, short_code, version_label, qty_per_parcel, is_extra?}.
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
  normal uuid[] := '{}';
  extra uuid[] := '{}';
  tid uuid;
  i integer := 0;
  is_x boolean;
begin
  perform public.dispatch_lock_draft(p_round);
  if jsonb_typeof(p_tutes) <> 'array' or jsonb_array_length(p_tutes) > 30 then
    raise exception 'Choose at most 30 tutes.' using errcode = 'P0001';
  end if;

  for t in select value from jsonb_array_elements(p_tutes) loop
    i := i + 1;
    pid := nullif(t ->> 'paper_id', '')::uuid;
    is_x := coalesce((t ->> 'is_extra')::boolean, false);
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
        is_extra = is_x,
        sort_order = i
      where id = tid and round_id = p_round;
    else
      insert into public.round_tutes (round_id, paper_id, manual_title, title, short_code, version_label, qty_per_parcel, is_extra, sort_order)
      values (p_round, pid, case when pid is null then trim(t ->> 'manual_title') end,
              coalesce(ptitle, trim(t ->> 'manual_title')), upper(trim(t ->> 'short_code')),
              coalesce(trim(t ->> 'version_label'), ''), coalesce((t ->> 'qty_per_parcel')::integer, 1), is_x, i)
      returning id into tid;
    end if;
    keep := keep || tid;
    if is_x then extra := extra || tid; else normal := normal || tid; end if;
  end loop;

  delete from public.round_tutes where round_id = p_round and not (id = any (keep));
  -- Exclusions only make sense for normal tutes, extras only for extra tutes.
  update public.round_students
     set excluded_tute_ids = array(select x from unnest(excluded_tute_ids) as x where x = any (normal)),
         extra_tute_ids    = array(select x from unnest(extra_tute_ids) as x where x = any (extra))
   where round_id = p_round and not (excluded_tute_ids <@ normal and extra_tute_ids <@ extra);
  update public.dispatch_rounds set updated_by = actor, updated_at = now() where id = p_round;
end;
$$;

-- Each row: {student_id, cod_amount?, note?, excluded_tute_ids?, extra_tute_ids?}.
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
  extras uuid[];
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
    extras := coalesce(array(select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(row_ -> 'extra_tute_ids', '[]'::jsonb)) as x), '{}');
    if exists (select 1 from unnest(excluded) e where not exists
                 (select 1 from public.round_tutes where id = e and round_id = p_round and not is_extra))
       or exists (select 1 from unnest(extras) e where not exists
                 (select 1 from public.round_tutes where id = e and round_id = p_round and is_extra)) then
      raise exception 'Unknown tute in the contents.' using errcode = 'P0001';
    end if;
    insert into public.round_students (round_id, student_id, cod_amount, note, excluded_tute_ids, extra_tute_ids)
    values (p_round, sid, nullif(row_ ->> 'cod_amount', '')::numeric, coalesce(trim(row_ ->> 'note'), ''), excluded, extras);
    n := n + 1;
  end loop;
  update public.dispatch_rounds set updated_by = actor, updated_at = now() where id = p_round;
  return n;
end;
$$;

-- Does this student's parcel hold this tute?
create or replace function public.round_student_gets(t public.round_tutes, rs public.round_students)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when t.is_extra then t.id = any (rs.extra_tute_ids) else not (t.id = any (rs.excluded_tute_ids)) end;
$$;

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
           when not exists (select 1 from public.round_tutes t where t.round_id = p_round and public.round_student_gets(t, rs2))
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
          or not exists (select 1 from public.round_tutes t where t.round_id = p_round and public.round_student_gets(t, rs2))
          or exists (select 1 from public.parcels p where p.reference = r.ref_prefix || s.student_no)
          or char_length(r.ref_prefix || s.student_no) > 40
          or s.student_no !~ '^[0-9A-Z]+$')
   order by s.student_no
   limit 1;
  if problem is not null then
    raise exception 'Can''t finalise – %', problem using errcode = 'P0001';
  end if;

  for rs in
    select rs2 as plan, rs2.student_id, rs2.cod_amount, s.student_no, s.full_name, s.address_line1, s.address_line2,
           s.address_line3, s.city, s.phone1, s.phone2
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
     where t.round_id = p_round and public.round_student_gets(t, rs.plan);

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

-- -----------------------------------------------------------------------------
-- 5. Packing station: how many copies of each tute this round needs (no personal data)
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_tute_counts(p_round uuid)
returns table (
  round_tute_id uuid, short_code text, title text, is_extra boolean,
  parcels integer, copies integer, packed_parcels integer, packed_copies integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_page('dispatch') then
    raise exception 'You are not allowed to see this round.' using errcode = '42501';
  end if;
  return query
    select t.id, t.short_code, t.title, t.is_extra,
           count(p.id)::integer,
           coalesce(sum(i.qty), 0)::integer,
           (count(p.id) filter (where p.pack_state <> 'planned'))::integer,
           coalesce(sum(i.qty) filter (where p.pack_state <> 'planned'), 0)::integer
      from public.round_tutes t
      -- Voided parcels don't count (their items are left out with them).
      left join (public.parcel_items i join public.parcels p on p.id = i.parcel_id and p.registration_state <> 'voided')
             on i.round_tute_id = t.id
     where t.round_id = p_round
     group by t.id
     order by t.sort_order;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Row level security and privileges
-- -----------------------------------------------------------------------------
alter table public.dispatch_tutes enable row level security;
drop policy if exists "dispatch_tutes: dispatch users read" on public.dispatch_tutes;
create policy "dispatch_tutes: dispatch users read" on public.dispatch_tutes for select to authenticated
  using ((select public.has_page('dispatch')));

revoke all on table public.dispatch_tutes from anon, authenticated;
grant select on table public.dispatch_tutes to authenticated;

revoke all on function public.round_student_gets(public.round_tutes, public.round_students) from public, anon, authenticated;
revoke all on function public.dispatch_tute_save(jsonb) from public, anon, authenticated;
revoke all on function public.dispatch_tute_archive(uuid) from public, anon, authenticated;
grant execute on function public.dispatch_tute_save(jsonb) to authenticated;
grant execute on function public.dispatch_tute_archive(uuid) to authenticated;
revoke all on function public.dispatch_tute_counts(uuid) from public, anon, authenticated;
grant execute on function public.dispatch_tute_counts(uuid) to authenticated;
