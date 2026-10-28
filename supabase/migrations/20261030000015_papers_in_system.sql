-- =============================================================================
-- Papers run fully in the system
--   1. Uploads in every stage (owner of that stage, or an admin). Reviews are
--      written in the system as corrections (paper_notes); the type setter is told.
--   2. Final outputs (hand-over PDFs and marking schemes) can be downloaded by
--      every active member; everyone can see the list of papers.
--   3. New stages after hand-over: Make marking scheme → Rewrite it clearly
--      (+ optional English translation).
--   4. One pair of WhatsApp group links for every paper (settings), and
--      "handed over" is stamped when the Hand over stage is done.
--   5. MCQ / Essay marking rates for the marking role (price 0 – set in Rates).
-- Supabase asks to confirm because old rules are replaced.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Stages
-- -----------------------------------------------------------------------------
alter table public.paper_stages drop constraint if exists paper_stages_stage_check;
alter table public.paper_stages add constraint paper_stages_stage_check check (stage in (
  'create_si', 'typeset_si', 'convert', 'typeset_en', 'review_si', 'review_en', 'handover',
  'scheme', 'scheme_rewrite', 'scheme_en', 'mark'
));
alter table public.paper_stages drop constraint if exists paper_stages_position_check;
alter table public.paper_stages add constraint paper_stages_position_check check (position between 1 and 12);
-- Marking moves to the end (after the marking-scheme stages).
update public.paper_stages set position = 11 where stage = 'mark' and position = 8;

create or replace function public.stage_label(p_stage text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'create_si' then 'Create (Sinhala)'
    when 'typeset_si' then 'Type set (Sinhala)'
    when 'convert' then 'Convert to English'
    when 'typeset_en' then 'Type set (English)'
    when 'review_si' then 'Review (Sinhala)'
    when 'review_en' then 'Review (English)'
    when 'handover' then 'Correct & hand over'
    when 'scheme' then 'Make marking scheme'
    when 'scheme_rewrite' then 'Rewrite marking scheme'
    when 'scheme_en' then 'Translate marking scheme'
    when 'mark' then 'Mark'
    else p_stage end;
$$;

create or replace function public.stage_deps(p_stage text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'create_si' then array[]::text[]
    when 'typeset_si' then array['create_si']
    when 'convert' then array['create_si']
    when 'typeset_en' then array['convert']
    when 'review_si' then array['typeset_si']
    when 'review_en' then array['typeset_en']
    when 'handover' then array['review_si', 'review_en']
    when 'scheme' then array['handover']
    when 'scheme_rewrite' then array['scheme']
    when 'scheme_en' then array['scheme']
    when 'mark' then array['handover']
    else array[]::text[] end;
$$;

-- Same as before, with the marking-scheme stages.
create or replace function public.create_paper(
  p_title text,
  p_kind text,
  p_exam uuid,
  p_notes text,
  p_stages jsonb,
  p_medium text default 'both',
  p_part text default 'full',
  p_exam_day date default null
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
begin
  if not public.is_admin() then
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

  insert into public.papers (title, kind, exam_id, notes, created_by, medium, part, exam_day)
  values (trim(p_title), p_kind, p_exam, nullif(trim(p_notes), ''), (select auth.uid()), p_medium, p_part, p_exam_day)
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

  select e.name into exam_name from public.exams e where e.id = p_exam;
  perform public.write_activity('paper.created', 'paper', v_paper::text, null,
    'Added the ' || p_kind || ' "' || trim(p_title) || '"' || coalesce(' for ' || exam_name, ''),
    jsonb_build_object('paper_id', v_paper, 'exam_id', p_exam, 'medium', p_medium, 'part', p_part));

  perform public.advance_paper(v_paper);
  return v_paper;
end;
$$;

-- Hand over done → the paper is handed over (no per-paper links any more).
create or replace function public.stamp_handover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage = 'handover' and new.status = 'done' and old.status is distinct from 'done' then
    update public.papers set handed_over_at = coalesce(handed_over_at, now()) where id = new.paper_id;
  end if;
  return null;
end;
$$;

create or replace trigger paper_stages_stamp_handover
  after update of status on public.paper_stages
  for each row execute function public.stamp_handover();

update public.papers p set handed_over_at = coalesce(p.handed_over_at, ps.completed_at)
from public.paper_stages ps
where ps.paper_id = p.id and ps.stage = 'handover' and ps.status = 'done' and p.handed_over_at is null;

-- -----------------------------------------------------------------------------
-- 2. Files: uploads in every stage; final outputs readable by every member
-- -----------------------------------------------------------------------------
alter table public.paper_files drop constraint if exists paper_files_stage_check;
alter table public.paper_files add constraint paper_files_stage_check check (stage in (
  'create_si', 'typeset_si', 'convert', 'typeset_en', 'review_si', 'review_en', 'handover',
  'scheme', 'scheme_rewrite', 'scheme_en'
));

-- Final outputs: the hand-over PDFs and the marking schemes.
create or replace function public.is_final_stage(p_stage text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_stage in ('handover', 'scheme', 'scheme_rewrite', 'scheme_en');
$$;

drop policy if exists "paper_files: owners and admins add" on public.paper_files;
drop policy if exists "paper_files: stage owner or admin adds" on public.paper_files;
create policy "paper_files: stage owner or admin adds" on public.paper_files for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and storage_path like paper_id::text || '/' || stage || '/%'
    and (
      public.is_admin()
      or (public.is_active_member() and exists (
        select 1 from public.paper_stages ps
        where ps.paper_id = paper_files.paper_id and ps.stage = paper_files.stage
          and ps.owner_id = (select auth.uid()) and ps.status in ('in_progress', 'done')
      ))
    )
  );

drop policy if exists "paper_files: final outputs for members" on public.paper_files;
create policy "paper_files: final outputs for members" on public.paper_files for select to authenticated
  using (public.is_final_stage(stage) and public.is_active_member());

drop policy if exists "papers bucket: owners and admins upload" on storage.objects;
create policy "papers bucket: owners and admins upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'papers'
    and public.can_access_paper(nullif((storage.foldername(name))[1], '')::uuid)
  );

drop policy if exists "papers bucket: final outputs for members" on storage.objects;
create policy "papers bucket: final outputs for members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'papers'
    and public.is_final_stage((storage.foldername(name))[2])
    and public.is_active_member()
  );

-- Everyone can see the list of papers (library, marking log). Stages and
-- draft files stay limited to the people working on the paper.
drop policy if exists "papers: members read" on public.papers;
create policy "papers: members read" on public.papers for select to authenticated
  using (public.is_active_member());

-- -----------------------------------------------------------------------------
-- 3. Corrections and notes on a paper (reviews in the system)
-- -----------------------------------------------------------------------------
create table if not exists public.paper_notes (
  id         uuid primary key default gen_random_uuid(),
  paper_id   uuid not null references public.papers (id) on delete cascade,
  stage      text check (stage in (
    'create_si', 'typeset_si', 'convert', 'typeset_en', 'review_si', 'review_en', 'handover',
    'scheme', 'scheme_rewrite', 'scheme_en', 'mark')),
  author_id  uuid references public.profiles (id) on delete set null,
  body       text not null check (char_length(trim(body)) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index if not exists paper_notes_paper_idx on public.paper_notes (paper_id, created_at);
create index if not exists paper_notes_author_idx on public.paper_notes (author_id);

alter table public.paper_notes enable row level security;
revoke all on public.paper_notes from anon;
revoke update, truncate on public.paper_notes from authenticated;

drop policy if exists "paper_notes: people on the paper read" on public.paper_notes;
create policy "paper_notes: people on the paper read" on public.paper_notes for select to authenticated
  using (public.can_access_paper(paper_id));
drop policy if exists "paper_notes: people on the paper write" on public.paper_notes;
create policy "paper_notes: people on the paper write" on public.paper_notes for insert to authenticated
  with check (author_id = (select auth.uid()) and public.is_active_member() and public.can_access_paper(paper_id));
drop policy if exists "paper_notes: author or admin deletes" on public.paper_notes;
create policy "paper_notes: author or admin deletes" on public.paper_notes for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_admin());

-- A new note tells the people who act on it: paper corrections → the type
-- setters and hand-over owner; marking-scheme notes → the marking-scheme people.
create or replace function public.notify_paper_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  paper_title text;
  who record;
begin
  select title into paper_title from public.papers where id = new.paper_id;
  for who in
    select distinct ps.owner_id from public.paper_stages ps
    where ps.paper_id = new.paper_id
      and ps.stage = any (
        case when new.stage in ('scheme', 'scheme_rewrite', 'scheme_en')
          then array['scheme', 'scheme_rewrite', 'scheme_en']
          else array['typeset_si', 'typeset_en', 'handover'] end
      )
      and ps.status <> 'skipped' and ps.owner_id is not null and ps.owner_id is distinct from new.author_id
  loop
    perform public.notify(who.owner_id, 'paper.note',
      'Corrections: ' || paper_title,
      coalesce(public.profile_name(new.author_id), 'Someone')
        || coalesce(' (' || public.stage_label(new.stage) || ')', '') || ': ' || left(new.body, 160),
      '/papers/' || new.paper_id::text);
  end loop;
  return null;
end;
$$;

create or replace trigger paper_notes_notify
  after insert on public.paper_notes
  for each row execute function public.notify_paper_note();

-- -----------------------------------------------------------------------------
-- 4. One pair of WhatsApp group links for every paper
-- -----------------------------------------------------------------------------
alter table public.app_settings add column if not exists lms_group_link text;
alter table public.app_settings add column if not exists physical_group_link text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_group_links_check') then
    alter table public.app_settings add constraint app_settings_group_links_check check (
      (lms_group_link is null or (lms_group_link ~* '^https://' and char_length(lms_group_link) <= 500))
      and (physical_group_link is null or (physical_group_link ~* '^https://' and char_length(physical_group_link) <= 500))
    );
  end if;
end;
$$;
-- Start from the links already saved on a paper, if any.
update public.app_settings s set
  lms_group_link = coalesce(s.lms_group_link, (select lms_link from public.papers where lms_link is not null order by updated_at desc limit 1)),
  physical_group_link = coalesce(s.physical_group_link, (select physical_link from public.papers where physical_link is not null order by updated_at desc limit 1))
where s.id;

create or replace function public.set_group_links(p_lms text, p_physical text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lms text := nullif(trim(p_lms), '');
  v_physical text := nullif(trim(p_physical), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the group links.' using errcode = '42501';
  end if;
  if (v_lms is not null and (v_lms !~* '^https://' or char_length(v_lms) > 500))
     or (v_physical is not null and (v_physical !~* '^https://' or char_length(v_physical) > 500)) then
    raise exception 'Paste full links that start with https://' using errcode = 'P0001';
  end if;
  update public.app_settings
  set lms_group_link = v_lms, physical_group_link = v_physical, updated_by = (select auth.uid()), updated_at = now()
  where id;
  perform public.write_activity('settings.group_links', 'settings', 'group_links', null,
    'Updated the WhatsApp group links', '{}'::jsonb);
end;
$$;

-- Every member: the two group links (the settings table itself is admins only).
create or replace function public.group_links()
returns table (lms_group_link text, physical_group_link text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.lms_group_link, s.physical_group_link
  from public.app_settings s
  where public.is_active_member()
  limit 1;
$$;

-- The usual paper team can include the marking-scheme stages.
create or replace function public.set_paper_default_owners(p_owners jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  v text;
  clean jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can set the paper team.' using errcode = '42501';
  end if;
  if p_owners is null or jsonb_typeof(p_owners) <> 'object' then
    raise exception 'Invalid team.' using errcode = 'P0001';
  end if;
  for k, v in select key, value from jsonb_each_text(p_owners) loop
    if k not in ('create_si', 'typeset_si', 'convert', 'typeset_en', 'review_si', 'review_en', 'handover',
                 'scheme', 'scheme_rewrite', 'scheme_en', 'mark') then
      raise exception 'Unknown stage: %', k using errcode = 'P0001';
    end if;
    continue when v is null or v = '';
    if not exists (select 1 from public.profiles where id = v::uuid and is_active) then
      raise exception 'Choose active members only.' using errcode = 'P0001';
    end if;
    clean := clean || jsonb_build_object(k, v);
  end loop;
  update public.app_settings set paper_default_owners = clean, updated_by = (select auth.uid()), updated_at = now() where id;
  perform public.write_activity('settings.paper_team', 'settings', 'paper_default_owners', null,
    'Saved the usual paper team', jsonb_build_object('owners', clean));
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Marking rates (per marked paper) for the marking role
-- -----------------------------------------------------------------------------
insert into public.rate_items (role_id, name, unit, price, sort_order)
select r.id, x.name, 'paper', 0, x.sort
from public.roles r
cross join (values ('MCQ paper marking', 20), ('Essay paper marking', 21)) as x(name, sort)
where r.name ilike '%marking%'
  and not exists (select 1 from public.rate_items ri where ri.role_id = r.id and lower(ri.name) = lower(x.name));

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
revoke execute on function public.stamp_handover() from public, anon, authenticated;
revoke execute on function public.notify_paper_note() from public, anon, authenticated;
revoke execute on function public.set_group_links(text, text) from public, anon;
grant execute on function public.set_group_links(text, text) to authenticated;
revoke execute on function public.group_links() from public, anon;
grant execute on function public.group_links() to authenticated;
grant execute on function public.is_final_stage(text) to authenticated;
