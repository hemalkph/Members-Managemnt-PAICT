-- =============================================================================
-- Tutes are created on Tute stock, not on Fee reminders. Safe to run more than once.
--
--   * tute_save: create or edit a catalog tute (name, code, active, pages, print
--     batch, "always keep at least", Paper Library PDF). Needs Tute stock edit access.
--   * class_tute_delete now needs Tute stock edit access (still refuses a tute
--     with stock or print history).
--   * Fee reminders can no longer create or rename tutes: the old
--     class_tute_create_and_assign / class_tute_update are closed. It still
--     picks tutes for each class and month (attach / remove / reorder).
--   * tute_paper_options: the Paper Library tutes a catalog tute can link to.
-- =============================================================================

create or replace function public.tute_save(
  p_id uuid,
  p_batch uuid,
  p_name text,
  p_code text default '',
  p_is_active boolean default true,
  p_pages integer default null,
  p_reorder_level integer default null,
  p_print_batch integer default 1,
  p_paper_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  tname text := trim(coalesce(p_name, ''));
  tcode text := trim(coalesce(p_code, ''));
  t record;
  tid uuid;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to add or change tutes.' using errcode = '42501';
  end if;
  if char_length(tname) < 2 or char_length(tname) > 150 then
    raise exception 'Tute name must be between 2 and 150 characters.' using errcode = 'P0001';
  end if;
  if char_length(tcode) > 30 then
    raise exception 'Tute code must be at most 30 characters.' using errcode = 'P0001';
  end if;
  if p_paper_id is not null and not exists (select 1 from public.papers where id = p_paper_id and kind = 'tute') then
    raise exception 'Pick a tute from the Paper Library.' using errcode = 'P0001';
  end if;

  if p_id is null then
    if not exists (select 1 from public.batches where id = p_batch) then
      raise exception 'Batch not found.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.class_tutes where batch_id = p_batch and lower(name) = lower(tname)) then
      raise exception 'A tute named "%" already exists in this batch.', tname using errcode = 'P0001';
    end if;
    insert into public.class_tutes (batch_id, code, name, is_active, pages, reorder_level, print_batch, paper_id, created_by)
    values (p_batch, tcode, tname, coalesce(p_is_active, true), p_pages, p_reorder_level, coalesce(p_print_batch, 1),
            p_paper_id, (select auth.uid()))
    returning id into tid;
    perform public.write_activity('tute.created', 'class_tute', tid::text, null,
      'Added tute "' || tname || '"', jsonb_build_object('batch_id', p_batch, 'code', tcode));
    return tid;
  end if;

  select id, batch_id, name into t from public.class_tutes where id = p_id for update;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.class_tutes where batch_id = t.batch_id and lower(name) = lower(tname) and id <> p_id) then
    raise exception 'A tute named "%" already exists in this batch.', tname using errcode = 'P0001';
  end if;
  update public.class_tutes
     set name = tname,
         code = tcode,
         is_active = coalesce(p_is_active, true),
         pages = p_pages,
         reorder_level = p_reorder_level,
         print_batch = coalesce(p_print_batch, 1),
         paper_id = p_paper_id
   where id = p_id;
  perform public.write_activity('tute.changed', 'class_tute', p_id::text, null,
    case when t.name <> tname then 'Renamed tute "' || t.name || '" to "' || tname || '"'
         else 'Changed tute "' || tname || '"' end,
    jsonb_build_object('code', tcode, 'is_active', coalesce(p_is_active, true), 'pages', p_pages,
                       'reorder_level', p_reorder_level, 'print_batch', p_print_batch, 'paper_id', p_paper_id));
  return p_id;
end;
$$;

-- Delete a tute that was never used for stock (otherwise archive it).
create or replace function public.class_tute_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  if not public.has_page('tutes', true) then
    raise exception 'You are not allowed to delete tutes.' using errcode = '42501';
  end if;
  select id, name into t from public.class_tutes where id = p_id;
  if t.id is null then
    raise exception 'Tute not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tute_stock_moves where tute_id = p_id)
     or exists (select 1 from public.tute_print_jobs where tute_id = p_id)
     or exists (select 1 from public.post_parcel_items where tute_id = p_id) then
    raise exception '"%" has stock, print or post history, so it can''t be deleted. Untick "In use" to archive it instead.', t.name
      using errcode = 'P0001';
  end if;
  delete from public.class_tutes where id = p_id;
  perform public.write_activity('tute.deleted', 'class_tute', p_id::text, null,
    'Deleted tute "' || t.name || '"', jsonb_build_object('name', t.name));
end;
$$;

-- Paper Library tutes to link a catalog tute to (its PDF).
create or replace function public.tute_paper_options()
returns table (id uuid, title text, medium text)
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
  select p.id, p.title, p.medium from public.papers p
  where p.kind = 'tute' and p.status <> 'cancelled'
  order by lower(p.title);
end;
$$;

-- Fee reminders no longer creates or renames tutes (Tute stock does).
revoke all on function public.class_tute_create_and_assign(uuid, uuid, text, text, date[], text) from public, anon, authenticated;
revoke all on function public.class_tute_update(uuid, text, text, boolean) from public, anon, authenticated;

revoke all on function public.tute_save(uuid, uuid, text, text, boolean, integer, integer, integer, uuid) from public, anon;
revoke all on function public.tute_paper_options() from public, anon;
grant execute on function public.tute_save(uuid, uuid, text, text, boolean, integer, integer, integer, uuid) to authenticated;
grant execute on function public.tute_paper_options() to authenticated;
