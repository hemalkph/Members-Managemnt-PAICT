-- =============================================================================
-- Monthly & Future-Month Class Tutes (for Fee Reminders now, and structured as
-- a clean reusable catalog + schedule for the future Tute Dispatch system).
-- Safe to run more than once.
--
--   class_tutes        Reusable tute catalog per batch (optionally scoped to a
--                      class and/or linked to a Paper Library tute).
--   class_month_tutes  Tutes scheduled for a (class, month) — supports past,
--                      current, AND future months, and allows the same tute to
--                      be assigned to multiple months without duplicating it.
--
-- Table/function names intentionally avoid all legacy dispatch names dropped
-- by migration 045 (dispatch_tutes, round_tutes, etc.).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.class_tutes (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.batches (id) on delete restrict,
  class_id   uuid references public.fee_classes (id) on delete set null,
  code       text not null default '' check (char_length(code) <= 30),
  name       text not null check (char_length(trim(name)) between 2 and 150),
  paper_id   uuid references public.papers (id) on delete set null,
  is_active  boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists class_tutes_batch_name_unique on public.class_tutes (batch_id, lower(name));
create index if not exists class_tutes_batch_idx on public.class_tutes (batch_id, is_active, lower(name));

create table if not exists public.class_month_tutes (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.fee_classes (id) on delete cascade,
  month      date not null check (extract(day from month) = 1),
  tute_id    uuid not null references public.class_tutes (id) on delete cascade,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  note       text not null default '' check (char_length(note) <= 200),
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (class_id, month, tute_id)
);
create index if not exists class_month_tutes_lookup_idx on public.class_month_tutes (class_id, month, sort_order, created_at);
create index if not exists class_month_tutes_tute_idx on public.class_month_tutes (tute_id);

-- -----------------------------------------------------------------------------
-- 2. RPC Functions
-- -----------------------------------------------------------------------------

-- Create a tute in the batch catalog (or reuse if same name exists) and assign it
-- to one or more months (past, current, or future months).
create or replace function public.class_tute_create_and_assign(
  p_batch_id uuid,
  p_class_id uuid,
  p_name text,
  p_code text default '',
  p_months date[] default '{}',
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  tname text := trim(coalesce(p_name, ''));
  tcode text := trim(coalesce(p_code, ''));
  tnote text := left(trim(coalesce(p_note, '')), 200);
  cls record;
  tid uuid;
  m_raw date;
  m date;
  next_pos integer;
  assigned integer := 0;
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to manage class tutes.' using errcode = '42501';
  end if;
  if char_length(tname) < 2 or char_length(tname) > 150 then
    raise exception 'Tute name must be between 2 and 150 characters.' using errcode = 'P0001';
  end if;
  if char_length(tcode) > 30 then
    raise exception 'Tute code must be at most 30 characters.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.batches where id = p_batch_id) then
    raise exception 'Batch not found.' using errcode = 'P0001';
  end if;
  if p_class_id is not null then
    select id, batch_id, name into cls from public.fee_classes where id = p_class_id;
    if cls.id is null or cls.batch_id <> p_batch_id then
      raise exception 'Class not found in this batch.' using errcode = 'P0001';
    end if;
  end if;

  -- Reuse existing catalog entry with same name in this batch if present, otherwise create.
  select id into tid
    from public.class_tutes
   where batch_id = p_batch_id and lower(name) = lower(tname);

  if tid is null then
    insert into public.class_tutes (batch_id, class_id, code, name, is_active, created_by)
    values (p_batch_id, p_class_id, tcode, tname, true, actor)
    returning id into tid;
  else
    update public.class_tutes
       set is_active = true,
           code = case when tcode <> '' then tcode else code end
     where id = tid;
  end if;

  if p_class_id is not null and p_months is not null and coalesce(array_length(p_months, 1), 0) > 0 then
    if array_length(p_months, 1) > 24 then
      raise exception 'Assign at most 24 months at once.' using errcode = 'P0001';
    end if;
    foreach m_raw in array p_months loop
      continue when m_raw is null;
      m := date_trunc('month', m_raw)::date;
      select coalesce(max(sort_order), -1) + 1 into next_pos
        from public.class_month_tutes
       where class_id = p_class_id and month = m;
      insert into public.class_month_tutes (class_id, month, tute_id, sort_order, note, added_by)
      values (p_class_id, m, tid, next_pos, tnote, actor)
      on conflict (class_id, month, tute_id) do update set
        note = case when excluded.note <> '' then excluded.note else class_month_tutes.note end;
      assigned := assigned + 1;
    end loop;
  end if;

  perform public.write_activity('fee.tute_added', 'class_tute', tid::text, null,
    'Added tute "' || tname || '"'
      || case when cls.name is not null and assigned > 0
         then ' to ' || cls.name || ' (' || assigned || ' month' || case when assigned = 1 then '' else 's' end || ')'
         else '' end,
    jsonb_build_object('batch_id', p_batch_id, 'class_id', p_class_id, 'tute_name', tname, 'months_assigned', assigned));

  return tid;
end;
$$;

-- Update a catalog tute's name, code, or active flag.
create or replace function public.class_tute_update(
  p_id uuid,
  p_name text,
  p_code text default '',
  p_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  tname text := trim(coalesce(p_name, ''));
  tcode text := trim(coalesce(p_code, ''));
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to manage class tutes.' using errcode = '42501';
  end if;
  if char_length(tname) < 2 or char_length(tname) > 150 then
    raise exception 'Tute name must be between 2 and 150 characters.' using errcode = 'P0001';
  end if;
  if char_length(tcode) > 30 then
    raise exception 'Tute code must be at most 30 characters.' using errcode = 'P0001';
  end if;
  select id, batch_id, name into t from public.class_tutes where id = p_id;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.class_tutes
    where batch_id = t.batch_id and lower(name) = lower(tname) and id <> p_id
  ) then
    raise exception 'A tute named "%" already exists in this batch.', tname using errcode = 'P0001';
  end if;

  update public.class_tutes
     set name = tname,
         code = tcode,
         is_active = coalesce(p_is_active, true)
   where id = p_id;

  perform public.write_activity('fee.tute_changed', 'class_tute', p_id::text, null,
    'Updated tute "' || tname || '"',
    jsonb_build_object('before_name', t.name, 'name', tname, 'code', tcode));
end;
$$;

-- Delete a catalog tute completely (removes it from all months).
create or replace function public.class_tute_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to manage class tutes.' using errcode = '42501';
  end if;
  select id, name into t from public.class_tutes where id = p_id;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  delete from public.class_tutes where id = p_id;
  perform public.write_activity('fee.tute_deleted', 'class_tute', p_id::text, null,
    'Deleted tute "' || t.name || '" from catalog',
    jsonb_build_object('name', t.name));
end;
$$;

-- Attach an existing catalog tute to a (class, month) — supports current & future months.
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
  if not public.has_page('fee_reminders', true) then
    raise exception 'You are not allowed to manage class tutes.' using errcode = '42501';
  end if;
  select id, batch_id, name into cls from public.fee_classes where id = p_class_id;
  if cls.id is null then
    raise exception 'Class not found.' using errcode = 'P0001';
  end if;
  select id, batch_id, name into tute from public.class_tutes where id = p_tute_id;
  if tute.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  if tute.batch_id <> cls.batch_id then
    raise exception 'That tute belongs to a different batch.' using errcode = 'P0001';
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

-- Unlink a tute from a single month (catalog entry and other months remain intact).
create or replace function public.class_month_tute_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_info record;
begin
  if not public.has_page('fee_reminders', true) then
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

-- Reorder scheduled tutes for a (class, month).
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
  if not public.has_page('fee_reminders', true) then
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
-- 3. Row Level Security & Grants
-- -----------------------------------------------------------------------------
alter table public.class_tutes       enable row level security;
alter table public.class_month_tutes enable row level security;

drop policy if exists "class_tutes: page read" on public.class_tutes;
create policy "class_tutes: page read" on public.class_tutes for select to authenticated
  using ((select public.has_page('fee_reminders')));

drop policy if exists "class_month_tutes: page read" on public.class_month_tutes;
create policy "class_month_tutes: page read" on public.class_month_tutes for select to authenticated
  using ((select public.has_page('fee_reminders')));

revoke all on table public.class_tutes, public.class_month_tutes from anon, authenticated;
grant select on table public.class_tutes, public.class_month_tutes to authenticated;

revoke all on function public.class_tute_create_and_assign(uuid, uuid, text, text, date[], text) from public, anon, authenticated;
revoke all on function public.class_tute_update(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.class_tute_delete(uuid) from public, anon, authenticated;
revoke all on function public.class_month_tute_attach(uuid, date, uuid, text) from public, anon, authenticated;
revoke all on function public.class_month_tute_remove(uuid) from public, anon, authenticated;
revoke all on function public.class_month_tute_reorder(uuid, date, uuid[]) from public, anon, authenticated;

grant execute on function public.class_tute_create_and_assign(uuid, uuid, text, text, date[], text) to authenticated;
grant execute on function public.class_tute_update(uuid, text, text, boolean) to authenticated;
grant execute on function public.class_tute_delete(uuid) to authenticated;
grant execute on function public.class_month_tute_attach(uuid, date, uuid, text) to authenticated;
grant execute on function public.class_month_tute_remove(uuid) to authenticated;
grant execute on function public.class_month_tute_reorder(uuid, date, uuid[]) to authenticated;
