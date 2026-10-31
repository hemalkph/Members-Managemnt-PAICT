-- =============================================================================
-- Tute dispatch, Phase 1: access, settings and the student delivery register.
-- Safe to run more than once.
--
-- Two layers of access:
--   1. Page access (existing): the "dispatch" page, none / view / edit.
--      Members can be given it, after two-step login, like Papers and Tasks.
--   2. Capabilities (new table dispatch_grants): plan, courier, pack, verify,
--      correct, finance. has_dispatch() = dispatch edit AND the capability.
--
-- Every write goes through the functions below. The tables give signed-in
-- users SELECT only (through RLS), because this project's default privileges
-- would otherwise give anon and authenticated full rights on new objects.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Page access: members can now be given the "dispatch" page.
--    Same body as migration 017, with 'dispatch' added to the member list.
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
      when p.is_admin and p.is_main_admin then true
      when p.is_admin then
        case coalesce(p.page_access ->> p_page, 'edit')
          when 'edit' then true
          when 'view' then not p_edit
          else false
        end
      when p_page = any (array['papers', 'tasks', 'classes', 'notices', 'dispatch'])
           and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2' then
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
-- 2. Capabilities
-- -----------------------------------------------------------------------------
create table if not exists public.dispatch_grants (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  capability    text not null check (capability in ('plan', 'courier', 'pack', 'verify', 'correct', 'finance')),
  reason        text check (char_length(reason) <= 300),
  granted_by    uuid references public.profiles (id) on delete set null,
  granted_at    timestamptz not null default now(),
  revoked_by    uuid references public.profiles (id) on delete set null,
  revoked_at    timestamptz,
  revoke_reason text check (char_length(revoke_reason) <= 300)
);

-- One active grant per person and capability; old grants stay as history.
create unique index if not exists dispatch_grants_active_unique
  on public.dispatch_grants (user_id, capability) where revoked_at is null;
create index if not exists dispatch_grants_user_idx on public.dispatch_grants (user_id);

-- Does the signed-in user have this dispatch capability?
--   main admin (two-step done): every capability
--   admin: plan, courier, pack, verify by default
--   anyone: an active grant
-- Always together with dispatch page edit access (which brings the two-step
-- rule for members and lets a main admin switch everything off at once).
create or replace function public.has_dispatch(p_cap text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_cap in ('plan', 'courier', 'pack', 'verify', 'correct', 'finance')
     and public.has_page('dispatch', true)
     and (
       public.is_main_admin()
       or exists (
         select 1 from public.profiles p
         where p.id = (select auth.uid()) and p.is_active and p.is_admin
           and p_cap in ('plan', 'courier', 'pack', 'verify')
       )
       or exists (
         select 1 from public.dispatch_grants g
         where g.user_id = (select auth.uid()) and g.capability = p_cap and g.revoked_at is null
       )
     );
$$;

-- The signed-in user's capabilities, for the app (one call instead of six).
create or replace function public.dispatch_my_caps()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c order by c), '{}')
  from unnest(array['plan', 'courier', 'pack', 'verify', 'correct', 'finance']) as c
  where public.has_dispatch(c);
$$;

create or replace function public.dispatch_grant(p_user uuid, p_cap text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  who text;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can give dispatch permissions.' using errcode = '42501';
  end if;
  if p_cap is null or p_cap not in ('plan', 'courier', 'pack', 'verify', 'correct', 'finance') then
    raise exception 'Unknown permission.' using errcode = 'P0001';
  end if;
  select coalesce(nullif(trim(full_name), ''), email) into who from public.profiles where id = p_user;
  if who is null then
    raise exception 'Member not found.' using errcode = 'P0001';
  end if;
  -- Already granted (also when two people grant at the same moment): nothing to do.
  insert into public.dispatch_grants (user_id, capability, reason, granted_by)
  values (p_user, p_cap, nullif(left(trim(coalesce(p_reason, '')), 300), ''), (select auth.uid()))
  on conflict (user_id, capability) where revoked_at is null do nothing;
  if not found then
    return;
  end if;

  perform public.write_activity(
    'dispatch.granted', 'dispatch', p_user::text, p_user,
    'Gave the ' || p_cap || ' dispatch permission to ' || who,
    jsonb_build_object('capability', p_cap));
end;
$$;

create or replace function public.dispatch_revoke(p_user uuid, p_cap text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  who text;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can remove dispatch permissions.' using errcode = '42501';
  end if;
  update public.dispatch_grants
     set revoked_at = now(),
         revoked_by = (select auth.uid()),
         revoke_reason = nullif(left(trim(coalesce(p_reason, '')), 300), '')
   where user_id = p_user and capability = p_cap and revoked_at is null;
  if not found then
    return; -- nothing to remove
  end if;

  select coalesce(nullif(trim(full_name), ''), email) into who from public.profiles where id = p_user;
  perform public.write_activity(
    'dispatch.revoked', 'dispatch', p_user::text, p_user,
    'Removed the ' || p_cap || ' dispatch permission from ' || coalesce(who, 'a member'),
    jsonb_build_object('capability', p_cap));
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Settings (one row)
-- -----------------------------------------------------------------------------
create table if not exists public.dispatch_settings (
  id                          boolean primary key default true check (id),
  sender_name                 text not null default '' check (char_length(sender_name) <= 100),
  sender_line1                text not null default '' check (char_length(sender_line1) <= 200),
  sender_line2                text not null default '' check (char_length(sender_line2) <= 200),
  sender_line3                text not null default '' check (char_length(sender_line3) <= 200),
  sender_city                 text not null default '' check (char_length(sender_city) <= 60),
  sender_contact_name         text not null default '' check (char_length(sender_contact_name) <= 100),
  sender_phone1               text not null default '' check (sender_phone1 = '' or sender_phone1 ~ '^0[0-9]{9}$'),
  sender_phone2               text not null default '' check (sender_phone2 = '' or sender_phone2 ~ '^0[0-9]{9}$'),
  default_cod                 numeric(12, 2) not null default 0 check (default_cod >= 0 and default_cod <= 1000000),
  default_weight_g            integer not null default 1000 check (default_weight_g between 1 and 30000),
  default_pieces              integer not null default 1 check (default_pieces between 1 and 20),
  require_verification        boolean not null default true,
  student_retention_months    integer not null default 12 check (student_retention_months between 1 and 120),
  recipient_retention_days    integer not null default 180 check (recipient_retention_days between 30 and 3650),
  courier_file_retention_days integer not null default 90 check (courier_file_retention_days between 7 and 3650),
  import_file_retention_days  integer not null default 30 check (import_file_retention_days between 1 and 365),
  updated_by                  uuid references public.profiles (id) on delete set null,
  updated_at                  timestamptz not null default now()
);

insert into public.dispatch_settings (id) values (true) on conflict (id) do nothing;

-- Sender details and defaults: plan. Verification and retention: main admins.
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

-- -----------------------------------------------------------------------------
-- 4. Students (delivery register; students never log in)
-- -----------------------------------------------------------------------------
create table if not exists public.students (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.batches (id) on delete restrict,
  student_no    text not null check (student_no ~ '^[0-9A-Za-z][0-9A-Za-z-]{0,19}$'),
  full_name     text not null check (char_length(trim(full_name)) between 1 and 120),
  address_line1 text not null default '' check (char_length(address_line1) <= 200),
  address_line2 text not null default '' check (char_length(address_line2) <= 200),
  address_line3 text not null default '' check (char_length(address_line3) <= 200),
  city          text not null default '' check (char_length(city) <= 60),
  region        text not null default '' check (char_length(region) <= 60),
  phone1        text check (phone1 ~ '^0[0-9]{9}$'),
  phone2        text check (phone2 ~ '^0[0-9]{9}$'),
  phone1_raw    text check (char_length(phone1_raw) <= 40),
  delivery_note text not null default '' check (char_length(delivery_note) <= 300),
  is_active     boolean not null default true,
  anonymised_at timestamptz,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now()
);

create unique index if not exists students_batch_no_unique on public.students (batch_id, student_no);
create index if not exists students_batch_name_idx on public.students (batch_id, lower(full_name));

create table if not exists public.student_imports (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid references public.batches (id) on delete set null,
  file_name       text not null check (char_length(file_name) between 1 and 200),
  storage_path    text check (storage_path ~ '^imports/[0-9a-f-]{36}\.(xlsx|csv)$'),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes      integer not null check (size_bytes between 1 and 15728640),
  row_count       integer not null check (row_count between 0 and 2000),
  counts          jsonb not null default '{}'::jsonb,
  applied_at      timestamptz,
  applied_count   integer,
  file_deleted_at timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists student_imports_created_idx on public.student_imports (created_at desc);

-- Add or edit one student. p_expected_updated_at stops two people
-- overwriting each other's changes.
create or replace function public.student_save(p jsonb, p_expected_updated_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid := nullif(p ->> 'id', '')::uuid;
  actor uuid := (select auth.uid());
begin
  if not public.has_dispatch('plan') then
    raise exception 'You are not allowed to change students.' using errcode = '42501';
  end if;

  if sid is null then
    insert into public.students (batch_id, student_no, full_name, address_line1, address_line2, address_line3,
                                 city, region, phone1, phone2, phone1_raw, delivery_note, created_by, updated_by)
    values ((p ->> 'batch_id')::uuid, upper(trim(p ->> 'student_no')), trim(p ->> 'full_name'),
            coalesce(trim(p ->> 'address_line1'), ''), coalesce(trim(p ->> 'address_line2'), ''),
            coalesce(trim(p ->> 'address_line3'), ''), coalesce(trim(p ->> 'city'), ''),
            coalesce(trim(p ->> 'region'), ''), nullif(trim(p ->> 'phone1'), ''), nullif(trim(p ->> 'phone2'), ''),
            nullif(trim(p ->> 'phone1_raw'), ''), coalesce(trim(p ->> 'delivery_note'), ''), actor, actor)
    returning id into sid;
    return sid;
  end if;

  update public.students set
    student_no    = upper(trim(p ->> 'student_no')),
    full_name     = trim(p ->> 'full_name'),
    address_line1 = coalesce(trim(p ->> 'address_line1'), ''),
    address_line2 = coalesce(trim(p ->> 'address_line2'), ''),
    address_line3 = coalesce(trim(p ->> 'address_line3'), ''),
    city          = coalesce(trim(p ->> 'city'), ''),
    region        = coalesce(trim(p ->> 'region'), ''),
    phone1        = nullif(trim(p ->> 'phone1'), ''),
    phone2        = nullif(trim(p ->> 'phone2'), ''),
    phone1_raw    = nullif(trim(p ->> 'phone1_raw'), ''),
    delivery_note = coalesce(trim(p ->> 'delivery_note'), ''),
    updated_by    = actor,
    updated_at    = now()
  where id = sid
    and anonymised_at is null
    and (p_expected_updated_at is null or updated_at = p_expected_updated_at);
  if not found then
    raise exception 'This student was changed by someone else (or removed). Reload and try again.' using errcode = 'P0001';
  end if;
  return sid;
end;
$$;

create or replace function public.student_set_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_dispatch('plan') then
    raise exception 'You are not allowed to change students.' using errcode = '42501';
  end if;
  update public.students
     set is_active = p_active, updated_by = (select auth.uid()), updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'Student not found.' using errcode = 'P0001';
  end if;
end;
$$;

-- Record an uploaded import file (the file itself is already in the private bucket).
create or replace function public.student_import_start(
  p_batch uuid, p_file_name text, p_storage_path text, p_sha256 text, p_size integer, p_rows integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  iid uuid;
begin
  if not public.has_dispatch('plan') then
    raise exception 'You are not allowed to import students.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.batches where id = p_batch) then
    raise exception 'Choose a batch.' using errcode = 'P0001';
  end if;
  insert into public.student_imports (batch_id, file_name, storage_path, sha256, size_bytes, row_count, created_by)
  values (p_batch, left(p_file_name, 200), p_storage_path, lower(p_sha256), p_size, p_rows, (select auth.uid()))
  returning id into iid;
  return iid;
end;
$$;

-- Save the rows the person approved in the preview, all or nothing.
-- Each row: {"action":"new"|"update", "student_no", fields..., "expected_updated_at"}.
-- For "update", only the keys present are changed. If anything changed
-- since the preview, nothing is saved and the preview must be run again.
create or replace function public.students_import_apply(p_import uuid, p_rows jsonb, p_counts jsonb default '{}'::jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  imp public.student_imports;
  r jsonb;
  n integer := 0;
  actor uuid := (select auth.uid());
  sno text;
begin
  if not public.has_dispatch('plan') then
    raise exception 'You are not allowed to import students.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Import at most 2,000 rows at a time.' using errcode = 'P0001';
  end if;

  select * into imp from public.student_imports where id = p_import for update;
  if imp.id is null then
    raise exception 'Import not found.' using errcode = 'P0001';
  end if;
  if imp.applied_at is not null then
    raise exception 'This import was already saved.' using errcode = 'P0001';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    sno := upper(trim(r ->> 'student_no'));
    if r ->> 'action' = 'new' then
      insert into public.students (batch_id, student_no, full_name, address_line1, address_line2, address_line3,
                                   city, region, phone1, phone2, phone1_raw, delivery_note, created_by, updated_by)
      values (imp.batch_id, sno, trim(r ->> 'full_name'),
              coalesce(trim(r ->> 'address_line1'), ''), coalesce(trim(r ->> 'address_line2'), ''),
              coalesce(trim(r ->> 'address_line3'), ''), coalesce(trim(r ->> 'city'), ''),
              coalesce(trim(r ->> 'region'), ''), nullif(trim(r ->> 'phone1'), ''), nullif(trim(r ->> 'phone2'), ''),
              nullif(trim(r ->> 'phone1_raw'), ''), coalesce(trim(r ->> 'delivery_note'), ''), actor, actor)
      on conflict (batch_id, student_no) do nothing;
      if not found then
        raise exception 'Student % was added by someone else after the preview. Run the preview again.', sno
          using errcode = 'P0001';
      end if;
    elsif r ->> 'action' = 'update' then
      update public.students s set
        full_name     = case when r ? 'full_name' then trim(r ->> 'full_name') else s.full_name end,
        address_line1 = case when r ? 'address_line1' then coalesce(trim(r ->> 'address_line1'), '') else s.address_line1 end,
        address_line2 = case when r ? 'address_line2' then coalesce(trim(r ->> 'address_line2'), '') else s.address_line2 end,
        address_line3 = case when r ? 'address_line3' then coalesce(trim(r ->> 'address_line3'), '') else s.address_line3 end,
        city          = case when r ? 'city' then coalesce(trim(r ->> 'city'), '') else s.city end,
        region        = case when r ? 'region' then coalesce(trim(r ->> 'region'), '') else s.region end,
        phone1        = case when r ? 'phone1' then nullif(trim(r ->> 'phone1'), '') else s.phone1 end,
        phone2        = case when r ? 'phone2' then nullif(trim(r ->> 'phone2'), '') else s.phone2 end,
        phone1_raw    = case when r ? 'phone1_raw' then nullif(trim(r ->> 'phone1_raw'), '') else s.phone1_raw end,
        delivery_note = case when r ? 'delivery_note' then coalesce(trim(r ->> 'delivery_note'), '') else s.delivery_note end,
        updated_by    = actor,
        updated_at    = now()
      where s.batch_id = imp.batch_id
        and s.student_no = sno
        and s.anonymised_at is null
        and s.updated_at = (r ->> 'expected_updated_at')::timestamptz;
      if not found then
        raise exception 'Student % changed after the preview. Run the preview again.', sno using errcode = 'P0001';
      end if;
    else
      raise exception 'Unknown import action.' using errcode = 'P0001';
    end if;
    n := n + 1;
  end loop;

  update public.student_imports
     set applied_at = now(), applied_count = n,
         counts = case when jsonb_typeof(p_counts) = 'object' then p_counts else '{}'::jsonb end
   where id = imp.id;

  perform public.write_activity('dispatch.students_imported', 'dispatch', imp.id::text, null,
    'Imported ' || n || ' student record' || case when n = 1 then '' else 's' end || ' from ' || imp.file_name,
    jsonb_build_object('import_id', imp.id, 'rows', n));
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Private bucket for dispatch files
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dispatch', 'dispatch', false, 15728640,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "dispatch bucket: planners upload imports" on storage.objects;
create policy "dispatch bucket: planners upload imports"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dispatch'
    and (storage.foldername(name))[1] = 'imports'
    and (select public.has_dispatch('plan'))
  );

drop policy if exists "dispatch bucket: planners read imports" on storage.objects;
create policy "dispatch bucket: planners read imports"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dispatch'
    and (storage.foldername(name))[1] = 'imports'
    and (select public.has_dispatch('plan'))
  );

-- -----------------------------------------------------------------------------
-- 6. Row level security (read only; writes go through the functions above)
-- -----------------------------------------------------------------------------
alter table public.dispatch_grants   enable row level security;
alter table public.dispatch_settings enable row level security;
alter table public.students          enable row level security;
alter table public.student_imports   enable row level security;

drop policy if exists "dispatch_grants: own or main admins read" on public.dispatch_grants;
create policy "dispatch_grants: own or main admins read" on public.dispatch_grants for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_main_admin()));

drop policy if exists "dispatch_settings: dispatch users read" on public.dispatch_settings;
create policy "dispatch_settings: dispatch users read" on public.dispatch_settings for select to authenticated
  using ((select public.has_page('dispatch')));

drop policy if exists "students: planners and courier read" on public.students;
create policy "students: planners and courier read" on public.students for select to authenticated
  using ((select public.has_dispatch('plan')) or (select public.has_dispatch('courier')));

drop policy if exists "student_imports: planners read" on public.student_imports;
create policy "student_imports: planners read" on public.student_imports for select to authenticated
  using ((select public.has_dispatch('plan')));

-- -----------------------------------------------------------------------------
-- 7. Privileges: nothing for anon; SELECT only for signed-in users.
-- -----------------------------------------------------------------------------
revoke all on table public.dispatch_grants, public.dispatch_settings, public.students, public.student_imports
  from anon, authenticated;
grant select on table public.dispatch_grants, public.dispatch_settings, public.students, public.student_imports
  to authenticated;

revoke all on function public.has_dispatch(text) from public, anon, authenticated;
revoke all on function public.dispatch_my_caps() from public, anon, authenticated;
revoke all on function public.dispatch_grant(uuid, text, text) from public, anon, authenticated;
revoke all on function public.dispatch_revoke(uuid, text, text) from public, anon, authenticated;
revoke all on function public.dispatch_settings_save(jsonb) from public, anon, authenticated;
revoke all on function public.student_save(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.student_set_active(uuid, boolean) from public, anon, authenticated;
revoke all on function public.student_import_start(uuid, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.students_import_apply(uuid, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.has_dispatch(text) to authenticated;
grant execute on function public.dispatch_my_caps() to authenticated;
grant execute on function public.dispatch_grant(uuid, text, text) to authenticated;
grant execute on function public.dispatch_revoke(uuid, text, text) to authenticated;
grant execute on function public.dispatch_settings_save(jsonb) to authenticated;
grant execute on function public.student_save(jsonb, timestamptz) to authenticated;
grant execute on function public.student_set_active(uuid, boolean) to authenticated;
grant execute on function public.student_import_start(uuid, text, text, text, integer, integer) to authenticated;
grant execute on function public.students_import_apply(uuid, jsonb, jsonb) to authenticated;
