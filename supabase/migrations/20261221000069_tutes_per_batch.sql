-- =============================================================================
-- Paper Library tutes belong to a batch. Safe to run more than once.
--
--   * papers.batch_id: the batch a tute is for. Papers still take their batch
--     from their exam; a tute takes its exam's batch when it has an exam.
--   * create_paper: new p_batch; a tute must have a batch.
--   * paper_library: batch_name falls back to the tute's own batch.
--   * tute_paper_options(p_batch): only that batch's Paper Library tutes.
--   * tute_save: a catalog tute can only link to a tute of its own batch.
-- =============================================================================

alter table public.papers add column if not exists batch_id uuid references public.batches (id) on delete set null;
create index if not exists papers_batch_idx on public.papers (batch_id);

-- Tutes made before this: take the exam's batch where there is one.
update public.papers p set batch_id = e.batch_id
from public.exams e
where e.id = p.exam_id and p.kind = 'tute' and p.batch_id is null;

-- -----------------------------------------------------------------------------
-- create_paper — new p_batch (required for tutes)
-- -----------------------------------------------------------------------------
drop function if exists public.create_paper(text, text, uuid, text, jsonb, text, text, date);

create or replace function public.create_paper(
  p_title text,
  p_kind text,
  p_exam uuid,
  p_notes text,
  p_stages jsonb,
  p_medium text default 'both',
  p_part text default 'full',
  p_exam_day date default null,
  p_batch uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paper uuid;
  s record;
  stage_id uuid;
  owner uuid;
  start_d date;
  due date;
  skip boolean;
  exam_name text;
  exam_batch uuid;
  v_batch uuid;
begin
  if not public.has_page('papers', true) then
    raise exception 'Only admins can add papers.' using errcode = '42501';
  end if;
  if p_kind not in ('paper', 'tute') then
    raise exception 'Choose paper or tute.' using errcode = 'P0001';
  end if;
  if p_medium not in ('si', 'both') then
    raise exception 'Choose the medium.' using errcode = 'P0001';
  end if;
  if p_part not in ('mcq', 'essay', 'full') then
    raise exception 'Choose the paper part.' using errcode = 'P0001';
  end if;

  select e.name, e.batch_id into exam_name, exam_batch from public.exams e where e.id = p_exam;
  if p_kind = 'tute' then
    v_batch := coalesce(exam_batch, p_batch);
    if v_batch is null or not exists (select 1 from public.batches where id = v_batch) then
      raise exception 'Choose the batch this tute is for.' using errcode = 'P0001';
    end if;
    if p_batch is not null and exam_batch is not null and p_batch <> exam_batch then
      raise exception 'The exam is in another batch. Pick an exam from the tute''s batch.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.papers (title, kind, exam_id, notes, created_by, medium, part, exam_day, batch_id)
  values (trim(p_title), p_kind, p_exam, nullif(trim(p_notes), ''), (select auth.uid()), p_medium, p_part, p_exam_day, v_batch)
  returning id into v_paper;

  for s in
    select * from (values
      ('create_si', 1), ('typeset_si', 2), ('convert', 3), ('typeset_en', 4),
      ('review_si', 5), ('review_en', 6), ('handover', 7),
      ('scheme', 8), ('scheme_rewrite', 9), ('scheme_en', 10), ('mark', 11)
    ) as v(stage, position)
  loop
    select (e ->> 'owner_id')::uuid, nullif(e ->> 'start_date', '')::date, nullif(e ->> 'due_date', '')::date,
           coalesce((e ->> 'skip')::boolean, false)
      into owner, start_d, due, skip
    from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb)) e
    where e ->> 'stage' = s.stage
    limit 1;

    skip := coalesce(skip, false);
    if p_medium = 'si' and s.stage in ('convert', 'typeset_en', 'review_en', 'scheme_en') then
      skip := true;
    end if;
    if start_d is not null and due is not null and start_d > due then
      raise exception '%: the start date is after the due date.', public.stage_label(s.stage) using errcode = 'P0001';
    end if;
    if owner is not null and not exists (select 1 from public.profiles where id = owner and is_active) then
      raise exception 'Choose an active member for every stage.' using errcode = 'P0001';
    end if;

    insert into public.paper_stages (paper_id, stage, position, owner_id, start_date, due_date, status)
    values (v_paper, s.stage, s.position, case when skip then null else owner end,
            case when skip then null else start_d end, case when skip then null else due end,
            case when skip then 'skipped' else 'waiting' end)
    returning id into stage_id;

    if not skip and owner is not null then
      insert into public.tasks (title, description, assignee_id, exam_id, due_date, status, paper_stage_id, created_by)
      values (public.stage_label(s.stage) || ': ' || trim(p_title),
              public.stage_task_description(start_d, due),
              owner, p_exam, due, 'waiting', stage_id, (select auth.uid()));
    end if;
    owner := null; start_d := null; due := null; skip := null;
  end loop;

  if not exists (select 1 from public.paper_stages where paper_stages.paper_id = v_paper and status = 'waiting') then
    raise exception 'Keep at least one stage.' using errcode = 'P0001';
  end if;

  perform public.write_activity('paper.created', 'paper', v_paper::text, null,
    'Added the ' || p_kind || ' "' || trim(p_title) || '"' || coalesce(' for ' || exam_name, ''),
    jsonb_build_object('paper_id', v_paper, 'exam_id', p_exam, 'batch_id', v_batch, 'medium', p_medium, 'part', p_part));

  perform public.advance_paper(v_paper);
  return v_paper;
end;
$$;

revoke all on function public.create_paper(text, text, uuid, text, jsonb, text, text, date, uuid) from public, anon;
grant execute on function public.create_paper(text, text, uuid, text, jsonb, text, text, date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- paper_library — a tute's batch comes from the tute when it has no exam
-- -----------------------------------------------------------------------------
create or replace function public.paper_library()
returns table (
  file_id uuid, paper_id uuid, title text, kind text, part text, medium text, exam_day date,
  exam_name text, batch_name text, stage text, version integer, file_name text, size_bytes bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (f.paper_id, f.stage)
         f.id, p.id, p.title, p.kind, p.part, p.medium, p.exam_day, e.name, coalesce(b.name, tb.name),
         f.stage, f.version, f.file_name, f.size_bytes, f.created_at
  from public.paper_files f
  join public.papers p on p.id = f.paper_id
  left join public.exams e on e.id = p.exam_id
  left join public.batches b on b.id = e.batch_id
  left join public.batches tb on tb.id = p.batch_id
  where (public.is_active_member() or public.is_admin())
    and f.stage in ('typeset_si', 'typeset_en', 'handover', 'scheme', 'scheme_rewrite', 'scheme_en')
    and public.library_file_ok(f.paper_id, f.stage)
  order by f.paper_id, f.stage, f.is_main desc, f.version desc;
$$;

revoke all on function public.paper_library() from public, anon;
grant execute on function public.paper_library() to authenticated;

-- -----------------------------------------------------------------------------
-- tute_paper_options — only the batch's own Paper Library tutes
-- -----------------------------------------------------------------------------
drop function if exists public.tute_paper_options();

create or replace function public.tute_paper_options(p_batch uuid)
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
  where p.kind = 'tute' and p.status <> 'cancelled' and p.batch_id = p_batch
  order by lower(p.title);
end;
$$;

revoke all on function public.tute_paper_options(uuid) from public, anon;
grant execute on function public.tute_paper_options(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- tute_save — the linked Paper Library tute must be in the same batch
-- -----------------------------------------------------------------------------
-- The older 9-argument version (from migration 067) skips the batch check.
drop function if exists public.tute_save(uuid, uuid, text, text, boolean, integer, integer, integer, uuid);

create or replace function public.tute_save(
  p_id uuid,
  p_batch uuid,
  p_name text,
  p_code text default '',
  p_is_active boolean default true,
  p_pages integer default null,
  p_reorder_level integer default null,
  p_print_batch integer default 1,
  p_paper_id uuid default null,
  p_opening_stock integer default null
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
  if p_paper_id is not null and not exists (
       select 1 from public.papers
       where id = p_paper_id and kind = 'tute'
         and batch_id = coalesce((select batch_id from public.class_tutes where id = p_id), p_batch)) then
    raise exception 'Pick a Paper Library tute from this batch.' using errcode = 'P0001';
  end if;
  if p_opening_stock is not null and (p_opening_stock < 0 or p_opening_stock > 100000) then
    raise exception 'Opening stock must be between 0 and 100,000.' using errcode = 'P0001';
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

    if p_opening_stock is not null and p_opening_stock > 0 then
      insert into public.tute_stock_moves (tute_id, qty, kind, note, created_by)
      values (tid, p_opening_stock, 'opening_stock', 'Opening stock', (select auth.uid()));
    end if;

    perform public.write_activity('tute.created', 'class_tute', tid::text, null,
      'Added tute "' || tname || '"' || case when coalesce(p_opening_stock, 0) > 0 then ' (' || p_opening_stock || ' opening copies)' else '' end,
      jsonb_build_object('batch_id', p_batch, 'code', tcode, 'opening_stock', p_opening_stock));
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

revoke all on function public.tute_save(uuid, uuid, text, text, boolean, integer, integer, integer, uuid, integer) from public, anon;
grant execute on function public.tute_save(uuid, uuid, text, text, boolean, integer, integer, integer, uuid, integer) to authenticated;
