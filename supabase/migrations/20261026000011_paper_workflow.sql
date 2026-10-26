-- =============================================================================
-- Paper workflow v2 (the class's real weekly flow)
--
--   1. Create (Sinhala)          Mon – Fri
--   2. Type set (Sinhala)  ┐     Sat – Sun   (at the same time)
--   3. Convert to English  ┘     Sat – Sun
--   4. Type set (English)        Mon
--   5. Review (Sinhala)    ┐     Mon – Tue   (paper creator)
--   6. Review (English)    ┘     Mon – Tue   (converter)
--   7. Correct & hand over       Tue        (PDF to the LMS + physical WhatsApp groups)
--   8. Mark (optional)           after the exam
--
-- * A stage starts as soon as every stage it depends on is done or skipped,
--   so Sinhala type setting and conversion run side by side.
-- * Sinhala-only papers skip 3, 4 and 6.
-- * Every stage has a start and a due date (defaults are filled in by the app).
-- * Files (drafts, PDFs) can be shared only in the first four stages, to pass
--   work from one member to the next. From the review stage on there are no
--   uploads (storage stays small): reviewers talk on WhatsApp, the final PDF
--   goes to the WhatsApp groups and admins add the two hand-over links.
-- * Stage owners can also add a link to their work (e.g. Google Drive).
-- Safe to run: there are no papers yet. Supabase will ask to confirm because
-- old rules and old function versions are replaced.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.papers add column if not exists medium text not null default 'both';
alter table public.papers add column if not exists part text not null default 'full';
alter table public.papers add column if not exists exam_day date;          -- physical centres write it on this day
alter table public.papers add column if not exists lms_link text;
alter table public.papers add column if not exists physical_link text;
alter table public.papers add column if not exists handed_over_at timestamptz;

alter table public.papers drop constraint if exists papers_medium_check;
alter table public.papers add constraint papers_medium_check check (medium in ('si', 'both'));
alter table public.papers drop constraint if exists papers_part_check;
alter table public.papers add constraint papers_part_check check (part in ('mcq', 'essay', 'full'));
alter table public.papers drop constraint if exists papers_links_check;
alter table public.papers add constraint papers_links_check check (
  (lms_link is null or (lms_link ~* '^https?://' and char_length(lms_link) <= 500))
  and (physical_link is null or (physical_link ~* '^https?://' and char_length(physical_link) <= 500))
);

alter table public.paper_stages add column if not exists start_date date;
alter table public.paper_stages add column if not exists link text;

alter table public.paper_stages drop constraint if exists paper_stages_stage_check;
alter table public.paper_stages add constraint paper_stages_stage_check check (stage in (
  'create_si', 'typeset_si', 'convert', 'typeset_en', 'review_si', 'review_en', 'handover', 'mark'
));
alter table public.paper_stages drop constraint if exists paper_stages_position_check;
alter table public.paper_stages add constraint paper_stages_position_check check (position between 1 and 8);
alter table public.paper_stages drop constraint if exists paper_stages_link_check;
alter table public.paper_stages add constraint paper_stages_link_check
  check (link is null or (link ~* '^https?://' and char_length(link) <= 500));
alter table public.paper_stages drop constraint if exists paper_stages_dates_check;
alter table public.paper_stages add constraint paper_stages_dates_check
  check (start_date is null or due_date is null or start_date <= due_date);

-- -----------------------------------------------------------------------------
-- Uploads only in the first four stages (Create, Type set ×2, Convert)
-- -----------------------------------------------------------------------------
alter table public.paper_files drop constraint if exists paper_files_stage_check;
alter table public.paper_files add constraint paper_files_stage_check
  check (stage in ('create_si', 'typeset_si', 'convert', 'typeset_en'));

drop policy if exists "paper_files: owners and admins add" on public.paper_files;
create policy "paper_files: owners and admins add" on public.paper_files for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and public.can_access_paper(paper_id)
    and stage in ('create_si', 'typeset_si', 'convert', 'typeset_en')
    and storage_path like paper_id::text || '/' || stage || '/%'
  );

drop policy if exists "papers bucket: owners and admins upload" on storage.objects;
create policy "papers bucket: owners and admins upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'papers'
    and (storage.foldername(name))[2] in ('create_si', 'typeset_si', 'convert', 'typeset_en')
    and public.can_access_paper(nullif((storage.foldername(name))[1], '')::uuid)
  );

-- -----------------------------------------------------------------------------
-- WhatsApp numbers of the people working on a paper (only for people who can
-- see that paper), so reviewers can message the creator, converter and type setter.
-- -----------------------------------------------------------------------------
create or replace function public.paper_contacts(p_paper uuid)
returns table (stage text, user_id uuid, full_name text, whatsapp text)
language sql
stable
security definer
set search_path = ''
as $$
  select ps.stage, p.id, coalesce(nullif(p.full_name, ''), p.email), coalesce(nullif(p.whatsapp, ''), p.phone)
  from public.paper_stages ps
  join public.profiles p on p.id = ps.owner_id
  where ps.paper_id = p_paper
    and ps.status <> 'skipped'
    and p.is_active
    and public.can_access_paper(p_paper)
  order by ps.position;
$$;

-- -----------------------------------------------------------------------------
-- Stage names, order and dependencies
-- -----------------------------------------------------------------------------
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
    when 'mark' then 'Mark'
    else p_stage end;
$$;

-- Which stages must be finished (done or skipped) before this one starts.
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
    when 'mark' then array['handover']
    else array[]::text[] end;
$$;

-- -----------------------------------------------------------------------------
-- Start every stage whose earlier stages are finished; finish the paper when
-- nothing is left.
-- -----------------------------------------------------------------------------
create or replace function public.advance_paper(p_paper uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_stage record;
  paper_title text;
  admin_row record;
begin
  select title into paper_title from public.papers where id = p_paper and status = 'in_progress';
  if paper_title is null then
    return;
  end if;

  for next_stage in
    select ps.* from public.paper_stages ps
    where ps.paper_id = p_paper and ps.status = 'waiting'
      and not exists (
        select 1 from public.paper_stages dep
        where dep.paper_id = p_paper
          and dep.stage = any (public.stage_deps(ps.stage))
          and dep.status not in ('done', 'skipped')
      )
    order by ps.position
  loop
    update public.paper_stages set status = 'in_progress' where id = next_stage.id;
    -- Its task opens (the task trigger tells the owner it's their turn).
    update public.tasks set status = 'open' where paper_stage_id = next_stage.id and status = 'waiting';

    if next_stage.owner_id is null then
      for admin_row in select id from public.profiles where is_admin and is_active loop
        perform public.notify(admin_row.id, 'paper.unassigned',
          public.stage_label(next_stage.stage) || ' has no owner: "' || paper_title || '"',
          'Choose who does this stage.', '/papers/' || p_paper::text,
          'paper-unassigned:' || next_stage.id::text);
      end loop;
    end if;
  end loop;

  if not exists (
    select 1 from public.paper_stages where paper_id = p_paper and status in ('waiting', 'in_progress')
  ) then
    update public.papers set status = 'done', completed_at = now() where id = p_paper and status = 'in_progress';
    perform public.write_activity('paper.done', 'paper', p_paper::text, null,
      'Finished "' || paper_title || '" (all stages done)', jsonb_build_object('paper_id', p_paper));
  end if;
end;
$$;

-- Text for a stage task: the working days.
create or replace function public.stage_task_description(p_start date, p_due date)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'Paper production stage. '
    || case
         when p_start is not null and p_due is not null and p_start <> p_due then
           'Work days: ' || trim(to_char(p_start, 'Dy FMDD Mon')) || ' – ' || trim(to_char(p_due, 'Dy FMDD Mon')) || '. '
         when p_due is not null then 'Work day: ' || trim(to_char(p_due, 'Dy FMDD Mon')) || '. '
         else '' end
    || 'Add your work link on the paper page, then mark your stage done.';
$$;

-- -----------------------------------------------------------------------------
-- Admins: create a paper with its stages.
-- p_stages = [{stage, owner_id, start_date, due_date, skip}]
-- -----------------------------------------------------------------------------
drop function if exists public.create_paper(text, text, uuid, text, jsonb);

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
      ('review_si', 5), ('review_en', 6), ('handover', 7), ('mark', 8)
    ) as v(stage, position)
  loop
    select (e ->> 'owner_id')::uuid, nullif(e ->> 'start_date', '')::date, nullif(e ->> 'due_date', '')::date,
           coalesce((e ->> 'skip')::boolean, false)
      into owner, start_d, due, skip
    from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb)) e
    where e ->> 'stage' = s.stage
    limit 1;

    skip := coalesce(skip, false);
    -- English stages are not needed for a Sinhala-only paper.
    if p_medium = 'si' and s.stage in ('convert', 'typeset_en', 'review_en') then
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

-- -----------------------------------------------------------------------------
-- Admins: change a stage's owner / dates, skip it, or mark it done.
-- -----------------------------------------------------------------------------
drop function if exists public.update_paper_stage(uuid, uuid, date, text);

create or replace function public.update_paper_stage(
  p_stage uuid,
  p_owner uuid,
  p_start date,
  p_due date,
  p_action text default 'save'  -- 'save' | 'skip' | 'done'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st record;
  paper record;
  task_status text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change stages.' using errcode = '42501';
  end if;
  select * into st from public.paper_stages where id = p_stage;
  if not found then
    raise exception 'Stage not found.' using errcode = 'P0001';
  end if;
  select * into paper from public.papers where id = st.paper_id;
  if p_owner is not null and not exists (select 1 from public.profiles where id = p_owner and is_active) then
    raise exception 'Choose an active member.' using errcode = 'P0001';
  end if;
  if p_start is not null and p_due is not null and p_start > p_due then
    raise exception 'The start date is after the due date.' using errcode = 'P0001';
  end if;

  if p_action = 'skip' then
    if st.status = 'done' then
      raise exception 'This stage is already done.' using errcode = 'P0001';
    end if;
    update public.paper_stages set status = 'skipped', completed_at = null where id = p_stage;
    update public.tasks set status = 'cancelled' where paper_stage_id = p_stage and status in ('waiting', 'open');
    perform public.advance_paper(st.paper_id);
    return;
  end if;

  if st.status = 'skipped' and p_action = 'save' and p_owner is not null then
    -- Bring a skipped stage back. If a later stage already started it simply runs now.
    update public.paper_stages set status = 'waiting' where id = p_stage;
    st.status := 'waiting';
  end if;

  update public.paper_stages set owner_id = p_owner, start_date = p_start, due_date = p_due where id = p_stage;

  task_status := case st.status when 'in_progress' then 'open' when 'waiting' then 'waiting' else null end;
  if p_owner is null then
    update public.tasks set status = 'cancelled' where paper_stage_id = p_stage and status in ('waiting', 'open');
  elsif task_status is not null then
    if exists (select 1 from public.tasks where paper_stage_id = p_stage) then
      update public.tasks
      set assignee_id = p_owner, due_date = p_due,
          description = public.stage_task_description(p_start, p_due),
          status = case when status = 'cancelled' then task_status else status end
      where paper_stage_id = p_stage;
    else
      insert into public.tasks (title, description, assignee_id, exam_id, due_date, status, paper_stage_id, created_by)
      values (public.stage_label(st.stage) || ': ' || paper.title,
              public.stage_task_description(p_start, p_due),
              p_owner, paper.exam_id, p_due, task_status, p_stage, (select auth.uid()));
    end if;
  end if;

  if p_action = 'done' then
    update public.paper_stages set status = 'done', completed_at = now() where id = p_stage;
    update public.tasks set status = 'done' where paper_stage_id = p_stage and status <> 'done';
  end if;
  perform public.advance_paper(st.paper_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- The stage owner (or an admin) saves the link to their work.
-- -----------------------------------------------------------------------------
create or replace function public.set_stage_link(p_stage uuid, p_link text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st record;
  v_link text := nullif(trim(p_link), '');
begin
  select * into st from public.paper_stages where id = p_stage;
  if not found then
    raise exception 'Stage not found.' using errcode = 'P0001';
  end if;
  if not (public.is_admin() or (st.owner_id = (select auth.uid()) and public.is_active_member())) then
    raise exception 'Only the stage owner or an admin can add the link.' using errcode = '42501';
  end if;
  if v_link is not null and (v_link !~* '^https?://' or char_length(v_link) > 500) then
    raise exception 'Paste a full link that starts with https://' using errcode = 'P0001';
  end if;
  update public.paper_stages set link = v_link where id = p_stage;
end;
$$;

-- -----------------------------------------------------------------------------
-- Admins: the hand-over links (LMS WhatsApp group + physical coordinator group).
-- -----------------------------------------------------------------------------
create or replace function public.set_paper_links(p_paper uuid, p_lms text, p_physical text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lms text := nullif(trim(p_lms), '');
  v_physical text := nullif(trim(p_physical), '');
  paper record;
begin
  if not public.is_admin() then
    raise exception 'Only admins can add hand-over links.' using errcode = '42501';
  end if;
  if (v_lms is not null and (v_lms !~* '^https?://' or char_length(v_lms) > 500))
     or (v_physical is not null and (v_physical !~* '^https?://' or char_length(v_physical) > 500)) then
    raise exception 'Paste full links that start with https://' using errcode = 'P0001';
  end if;
  select * into paper from public.papers where id = p_paper;
  if not found then
    raise exception 'Paper not found.' using errcode = 'P0001';
  end if;

  update public.papers
  set lms_link = v_lms,
      physical_link = v_physical,
      handed_over_at = case when v_lms is not null and v_physical is not null then coalesce(handed_over_at, now()) else null end
  where id = p_paper;

  if v_lms is not null and v_physical is not null and paper.handed_over_at is null then
    perform public.write_activity('paper.handed_over', 'paper', p_paper::text, null,
      'Added the hand-over links for "' || paper.title || '"', jsonb_build_object('paper_id', p_paper));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
revoke execute on function public.stage_deps(text) from public, anon, authenticated;
revoke execute on function public.stage_task_description(date, date) from public, anon, authenticated;
revoke execute on function public.advance_paper(uuid) from public, anon, authenticated;

revoke execute on function public.create_paper(text, text, uuid, text, jsonb, text, text, date) from public, anon;
revoke execute on function public.update_paper_stage(uuid, uuid, date, date, text) from public, anon;
revoke execute on function public.set_stage_link(uuid, text) from public, anon;
revoke execute on function public.set_paper_links(uuid, text, text) from public, anon;
revoke execute on function public.paper_contacts(uuid) from public, anon;
grant execute on function public.paper_contacts(uuid) to authenticated;
grant execute on function public.create_paper(text, text, uuid, text, jsonb, text, text, date) to authenticated;
grant execute on function public.update_paper_stage(uuid, uuid, date, date, text) to authenticated;
grant execute on function public.set_stage_link(uuid, text) to authenticated;
grant execute on function public.set_paper_links(uuid, text, text) to authenticated;
