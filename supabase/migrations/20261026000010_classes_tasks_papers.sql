-- =============================================================================
-- Step 3 – class work
--   1. Batches, exams and class centres; work can be tagged with an exam and a centre.
--   2. Tasks: admins assign work with a due date; members log work against it.
--   3. Paper production tracker: Created → Type set → Converted to English → Marked.
--      Every stage has an owner and a due date and becomes a task for them.
--      When a stage is done the next one starts and its owner is notified.
--      Files are kept per stage with version numbers (private "papers" bucket).
-- (No DROP statements, so it runs without confirmation.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Batches, exams, centres
-- -----------------------------------------------------------------------------
create table if not exists public.batches (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) between 2 and 60),
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists batches_name_unique on public.batches (lower(name));

create table if not exists public.exams (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid not null references public.batches (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 2 and 80),
  exam_date  date,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists exams_batch_name_unique on public.exams (batch_id, lower(name));
create index if not exists exams_batch_idx on public.exams (batch_id);

create table if not exists public.centres (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) between 2 and 60),
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists centres_name_unique on public.centres (lower(name));

alter table public.batches enable row level security;
alter table public.exams enable row level security;
alter table public.centres enable row level security;
revoke all on public.batches, public.exams, public.centres from anon;

create policy "batches: signed-in users read" on public.batches for select to authenticated using (true);
create policy "batches: admins manage" on public.batches for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "exams: signed-in users read" on public.exams for select to authenticated using (true);
create policy "exams: admins manage" on public.exams for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "centres: signed-in users read" on public.centres for select to authenticated using (true);
create policy "centres: admins manage" on public.centres for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- 3a. Papers and stages (before tasks, which point at stages)
-- -----------------------------------------------------------------------------
create table if not exists public.papers (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(trim(title)) between 2 and 150),
  kind         text not null default 'paper' check (kind in ('paper', 'tute')),
  exam_id      uuid references public.exams (id) on delete set null,
  notes        text check (char_length(notes) <= 1000),
  status       text not null default 'in_progress' check (status in ('in_progress', 'done', 'cancelled')),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists papers_exam_idx on public.papers (exam_id);
create index if not exists papers_created_by_idx on public.papers (created_by);

create or replace trigger papers_set_updated_at
  before update on public.papers
  for each row execute function public.set_updated_at();

create table if not exists public.paper_stages (
  id           uuid primary key default gen_random_uuid(),
  paper_id     uuid not null references public.papers (id) on delete cascade,
  stage        text not null check (stage in ('created', 'typeset', 'converted', 'marked')),
  position     smallint not null check (position between 1 and 4),
  owner_id     uuid references public.profiles (id) on delete set null,
  due_date     date,
  status       text not null default 'waiting' check (status in ('waiting', 'in_progress', 'done', 'skipped')),
  completed_at timestamptz,
  unique (paper_id, stage),
  unique (paper_id, position)
);
create index if not exists paper_stages_owner_idx on public.paper_stages (owner_id);

create table if not exists public.paper_files (
  id           uuid primary key default gen_random_uuid(),
  paper_id     uuid not null references public.papers (id) on delete cascade,
  stage        text not null check (stage in ('created', 'typeset', 'converted', 'marked')),
  version      integer not null check (version between 1 and 999),
  storage_path text not null unique,
  file_name    text not null check (char_length(file_name) between 1 and 200),
  mime_type    text,
  size_bytes   integer not null check (size_bytes between 1 and 26214400),
  note         text check (char_length(note) <= 300),
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (paper_id, stage, version)
);
create index if not exists paper_files_paper_idx on public.paper_files (paper_id, stage, version desc);
create index if not exists paper_files_uploaded_by_idx on public.paper_files (uploaded_by);

-- Admins, and anyone who owns a stage of the paper, can see it.
create or replace function public.can_access_paper(p_paper uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_active_member() and exists (
            select 1 from public.paper_stages
            where paper_id = p_paper and owner_id = (select auth.uid())
          ));
$$;

alter table public.papers enable row level security;
alter table public.paper_stages enable row level security;
alter table public.paper_files enable row level security;
revoke all on public.papers, public.paper_stages, public.paper_files from anon;
-- Papers and stages are created and moved on only by the functions below.
revoke insert, update, delete, truncate on public.papers, public.paper_stages from authenticated;
revoke update, truncate on public.paper_files from authenticated;

create policy "papers: owners and admins read" on public.papers for select to authenticated
  using (public.can_access_paper(id));
create policy "paper_stages: owners and admins read" on public.paper_stages for select to authenticated
  using (public.can_access_paper(paper_id));
create policy "paper_files: owners and admins read" on public.paper_files for select to authenticated
  using (public.can_access_paper(paper_id));
create policy "paper_files: owners and admins add" on public.paper_files for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and public.can_access_paper(paper_id)
    and storage_path like paper_id::text || '/%'
  );
create policy "paper_files: uploader or admin deletes" on public.paper_files for delete to authenticated
  using (uploaded_by = (select auth.uid()) or public.is_admin());

-- -----------------------------------------------------------------------------
-- 2. Tasks
-- -----------------------------------------------------------------------------
create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (char_length(trim(title)) between 2 and 150),
  description    text check (char_length(description) <= 2000),
  assignee_id    uuid not null references public.profiles (id) on delete cascade,
  role_id        uuid references public.roles (id) on delete set null,
  exam_id        uuid references public.exams (id) on delete set null,
  centre_id      uuid references public.centres (id) on delete set null,
  quantity       integer check (quantity between 1 and 100000),
  due_date       date,
  priority       text not null default 'normal' check (priority in ('normal', 'high')),
  -- waiting = a paper stage that hasn't started yet
  status         text not null default 'open' check (status in ('waiting', 'open', 'done', 'cancelled')),
  paper_stage_id uuid unique references public.paper_stages (id) on delete cascade,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id, status, due_date);
create index if not exists tasks_status_due_idx on public.tasks (status, due_date);
create index if not exists tasks_role_idx on public.tasks (role_id);
create index if not exists tasks_exam_idx on public.tasks (exam_id);
create index if not exists tasks_centre_idx on public.tasks (centre_id);
create index if not exists tasks_created_by_idx on public.tasks (created_by);

create or replace trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;
revoke all on public.tasks from anon;

create policy "tasks: read own" on public.tasks for select to authenticated
  using (assignee_id = (select auth.uid()));
create policy "tasks: members update own" on public.tasks for update to authenticated
  using (assignee_id = (select auth.uid()) and public.is_active_member())
  with check (assignee_id = (select auth.uid()));
create policy "tasks: admins manage" on public.tasks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Members may only mark their own open task as done (or undo it). Everything
-- else is for admins. completed_at is stamped automatically.
create or replace function public.guard_task_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- current_user is 'authenticated' for direct API calls; inside the paper flow
  -- functions (security definer) it is their owner, which is trusted.
  if (select auth.uid()) is not null and current_user = 'authenticated' and not public.is_admin() then
    if new.title is distinct from old.title or new.description is distinct from old.description
       or new.assignee_id is distinct from old.assignee_id or new.role_id is distinct from old.role_id
       or new.exam_id is distinct from old.exam_id or new.centre_id is distinct from old.centre_id
       or new.quantity is distinct from old.quantity or new.due_date is distinct from old.due_date
       or new.priority is distinct from old.priority or new.paper_stage_id is distinct from old.paper_stage_id
       or new.created_by is distinct from old.created_by then
      raise exception 'Only admins can change task details' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not (
         (old.status = 'open' and new.status = 'done')
         or (old.status = 'done' and new.status = 'open' and old.paper_stage_id is null)
       ) then
      raise exception 'You can only mark an open task as done' using errcode = '42501';
    end if;
  end if;
  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'done' then now() else null end;
  end if;
  return new;
end;
$$;

create or replace trigger tasks_guard_changes
  before update on public.tasks
  for each row execute function public.guard_task_changes();

-- -----------------------------------------------------------------------------
-- Work tags: exam, centre and task on submissions
-- -----------------------------------------------------------------------------
alter table public.submissions add column if not exists exam_id uuid references public.exams (id) on delete set null;
alter table public.submissions add column if not exists centre_id uuid references public.centres (id) on delete set null;
alter table public.submissions add column if not exists task_id uuid references public.tasks (id) on delete set null;
create index if not exists submissions_exam_idx on public.submissions (exam_id);
create index if not exists submissions_centre_idx on public.submissions (centre_id);
create index if not exists submissions_task_idx on public.submissions (task_id);

-- A member can only link work to their own task; the task's exam and centre are copied.
create or replace function public.check_submission_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  if new.task_id is null then
    return new;
  end if;
  select assignee_id, exam_id, centre_id into t from public.tasks where id = new.task_id;
  if not found or (t.assignee_id <> new.user_id and (select auth.uid()) is not null and not public.is_admin()) then
    raise exception 'That task is not yours' using errcode = '42501';
  end if;
  new.exam_id := coalesce(new.exam_id, t.exam_id);
  new.centre_id := coalesce(new.centre_id, t.centre_id);
  return new;
end;
$$;

create or replace trigger submissions_c_task
  before insert or update of task_id on public.submissions
  for each row execute function public.check_submission_task();

-- -----------------------------------------------------------------------------
-- Paper flow
-- -----------------------------------------------------------------------------
create or replace function public.stage_label(p_stage text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'created' then 'Create'
    when 'typeset' then 'Type set'
    when 'converted' then 'Convert to English'
    when 'marked' then 'Mark'
    else p_stage end;
$$;

-- Start the next stage, or finish the paper when nothing is left.
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
  if exists (select 1 from public.paper_stages where paper_id = p_paper and status = 'in_progress') then
    return;
  end if;

  select * into next_stage from public.paper_stages
  where paper_id = p_paper and status = 'waiting'
  order by position limit 1;

  if not found then
    update public.papers set status = 'done', completed_at = now()
    where id = p_paper and status = 'in_progress'
    returning title into paper_title;
    if paper_title is not null then
      perform public.write_activity('paper.done', 'paper', p_paper::text, null,
        'Finished "' || paper_title || '" (all stages done)', jsonb_build_object('paper_id', p_paper));
    end if;
    return;
  end if;

  update public.paper_stages set status = 'in_progress' where id = next_stage.id;
  -- Its task opens (the task trigger tells the owner it's their turn).
  update public.tasks set status = 'open' where paper_stage_id = next_stage.id and status = 'waiting';

  if next_stage.owner_id is null then
    select title into paper_title from public.papers where id = p_paper;
    for admin_row in select id from public.profiles where is_admin and is_active loop
      perform public.notify(admin_row.id, 'paper.unassigned',
        public.stage_label(next_stage.stage) || ' has no owner: "' || paper_title || '"',
        'Choose who does this stage.', '/papers/' || p_paper::text,
        'paper-unassigned:' || next_stage.id::text);
    end loop;
  end if;
end;
$$;

-- Admins: create a paper with its stages. p_stages = [{stage, owner_id, due_date, skip}]
create or replace function public.create_paper(
  p_title text,
  p_kind text,
  p_exam uuid,
  p_notes text,
  p_stages jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paper uuid;
  s record;
  pos smallint := 0;
  stage_id uuid;
  owner uuid;
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

  insert into public.papers (title, kind, exam_id, notes, created_by)
  values (trim(p_title), p_kind, p_exam, nullif(trim(p_notes), ''), (select auth.uid()))
  returning id into v_paper;

  for s in select * from (values ('created', 1), ('typeset', 2), ('converted', 3), ('marked', 4)) as v(stage, position) loop
    select (e ->> 'owner_id')::uuid, nullif(e ->> 'due_date', '')::date, coalesce((e ->> 'skip')::boolean, false)
      into owner, due, skip
    from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb)) e
    where e ->> 'stage' = s.stage
    limit 1;

    if owner is not null and not exists (select 1 from public.profiles where id = owner and is_active) then
      raise exception 'Choose an active member for every stage.' using errcode = 'P0001';
    end if;

    insert into public.paper_stages (paper_id, stage, position, owner_id, due_date, status)
    values (v_paper, s.stage, s.position, case when skip then null else owner end, due,
            case when coalesce(skip, false) then 'skipped' else 'waiting' end)
    returning id into stage_id;

    if not coalesce(skip, false) and owner is not null then
      insert into public.tasks (title, description, assignee_id, exam_id, due_date, status, paper_stage_id, created_by)
      values (public.stage_label(s.stage) || ': ' || trim(p_title),
              'Paper production stage. Upload your files on the paper page.',
              owner, p_exam, due, 'waiting', stage_id, (select auth.uid()));
    end if;
    owner := null; due := null; skip := null;
  end loop;

  if not exists (select 1 from public.paper_stages where paper_stages.paper_id = v_paper and status = 'waiting') then
    raise exception 'Keep at least one stage.' using errcode = 'P0001';
  end if;

  select e.name into exam_name from public.exams e where e.id = p_exam;
  perform public.write_activity('paper.created', 'paper', v_paper::text, null,
    'Added the ' || p_kind || ' "' || trim(p_title) || '"' || coalesce(' for ' || exam_name, ''),
    jsonb_build_object('paper_id', v_paper, 'exam_id', p_exam));

  perform public.advance_paper(v_paper);
  return v_paper;
end;
$$;

-- Admins: change a stage's owner / due date, skip it, or mark it done.
create or replace function public.update_paper_stage(
  p_stage uuid,
  p_owner uuid,
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
    -- Bring a skipped stage back.
    update public.paper_stages set status = 'waiting' where id = p_stage;
    st.status := 'waiting';
  end if;

  update public.paper_stages set owner_id = p_owner, due_date = p_due where id = p_stage;

  task_status := case st.status when 'in_progress' then 'open' when 'waiting' then 'waiting' else null end;
  if p_owner is null then
    update public.tasks set status = 'cancelled' where paper_stage_id = p_stage and status in ('waiting', 'open');
  elsif task_status is not null then
    if exists (select 1 from public.tasks where paper_stage_id = p_stage) then
      update public.tasks
      set assignee_id = p_owner, due_date = p_due,
          status = case when status = 'cancelled' then task_status else status end
      where paper_stage_id = p_stage;
    else
      insert into public.tasks (title, description, assignee_id, exam_id, due_date, status, paper_stage_id, created_by)
      values (public.stage_label(st.stage) || ': ' || paper.title,
              'Paper production stage. Upload your files on the paper page.',
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

-- Admins: cancel or delete a paper.
create or replace function public.set_paper_status(p_paper uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  paper_title text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change papers.' using errcode = '42501';
  end if;
  if p_status = 'deleted' then
    select title into paper_title from public.papers where id = p_paper;
    delete from public.papers where id = p_paper; -- stages, tasks and file rows go with it
    perform public.write_activity('paper.deleted', 'paper', p_paper::text, null,
      'Deleted the paper "' || coalesce(paper_title, '?') || '"', '{}'::jsonb);
    return;
  end if;
  if p_status not in ('cancelled', 'in_progress') then
    raise exception 'Unknown status.' using errcode = 'P0001';
  end if;
  update public.papers set status = p_status, completed_at = null where id = p_paper returning title into paper_title;
  if p_status = 'cancelled' then
    update public.tasks set status = 'cancelled'
    where status in ('waiting', 'open') and paper_stage_id in (select id from public.paper_stages where paper_id = p_paper);
  else
    update public.tasks t set status = case when ps.status = 'in_progress' then 'open' else 'waiting' end
    from public.paper_stages ps
    where t.paper_stage_id = ps.id and ps.paper_id = p_paper and t.status = 'cancelled'
      and ps.status in ('waiting', 'in_progress');
  end if;
  perform public.write_activity('paper.' || case when p_status = 'cancelled' then 'cancelled' else 'restarted' end,
    'paper', p_paper::text, null,
    case when p_status = 'cancelled' then 'Cancelled' else 'Restarted' end || ' the paper "' || paper_title || '"',
    '{}'::jsonb);
end;
$$;

-- Task → stage: when the owner marks their stage task done, the stage is done
-- and the next one starts.
create or replace function public.sync_paper_stage_from_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  st record;
begin
  if new.paper_stage_id is null or new.status is not distinct from old.status or new.status <> 'done' then
    return null;
  end if;
  select * into st from public.paper_stages where id = new.paper_stage_id;
  if found and st.status = 'in_progress' then
    update public.paper_stages set status = 'done', completed_at = now() where id = st.id;
    perform public.advance_paper(st.paper_id);
  end if;
  return null;
end;
$$;

create or replace trigger tasks_sync_paper_stage
  after update on public.tasks
  for each row execute function public.sync_paper_stage_from_task();

-- -----------------------------------------------------------------------------
-- Task notifications and activity log
-- -----------------------------------------------------------------------------
create or replace function public.task_link(p_task public.tasks)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  paper_id uuid;
begin
  if p_task.paper_stage_id is not null then
    select ps.paper_id into paper_id from public.paper_stages ps where ps.id = p_task.paper_stage_id;
    return '/papers/' || paper_id::text;
  end if;
  return '/tasks';
end;
$$;

create or replace function public.notify_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  due_text text := case when new.due_date is not null then 'Due ' || trim(to_char(new.due_date, 'FMDD Mon YYYY')) else 'No due date' end;
begin
  if tg_op = 'INSERT' then
    if new.status = 'open' and new.assignee_id is distinct from actor then
      perform public.notify(new.assignee_id, 'task.assigned', 'New task: ' || new.title, due_text,
        public.task_link(new), 'task-assigned:' || new.id::text);
    end if;
    if new.paper_stage_id is not null then
      return null; -- paper stages are logged with the paper
    end if;
    perform public.write_activity('task.assigned', 'task', new.id::text, new.assignee_id,
      'Assigned "' || new.title || '" to ' || coalesce(public.profile_name(new.assignee_id), 'a member')
        || case when new.due_date is not null then ' (due ' || trim(to_char(new.due_date, 'FMDD Mon')) || ')' else '' end,
      jsonb_build_object('due_date', new.due_date, 'status', new.status));
    return null;
  end if;

  -- A paper stage task becomes active.
  if old.status = 'waiting' and new.status = 'open' then
    if exists (
      select 1 from public.paper_stages ps
      where ps.status = 'done'
        and ps.paper_id = (select x.paper_id from public.paper_stages x where x.id = new.paper_stage_id)
    ) then
      perform public.notify(new.assignee_id, 'task.turn', 'Your turn: ' || new.title,
        'The previous stage is done. ' || due_text || '.', public.task_link(new), 'task-turn:' || new.id::text);
    else
      perform public.notify(new.assignee_id, 'task.assigned', 'New task: ' || new.title, due_text,
        public.task_link(new), 'task-assigned:' || new.id::text);
    end if;
  end if;
  -- Given to someone else.
  if new.assignee_id is distinct from old.assignee_id and new.status = 'open' then
    perform public.notify(new.assignee_id, 'task.assigned', 'New task: ' || new.title, due_text,
      public.task_link(new), 'task-assigned:' || new.id::text || ':' || new.assignee_id::text);
  end if;
  -- Finished.
  if new.status = 'done' and old.status is distinct from 'done' then
    if new.created_by is not null and new.created_by is distinct from actor then
      perform public.notify(new.created_by, 'task.done',
        coalesce(public.profile_name(new.assignee_id), 'A member') || ' finished: ' || new.title,
        null, case when new.paper_stage_id is not null then public.task_link(new) else '/admin/tasks' end);
    end if;
    perform public.write_activity('task.done', 'task', new.id::text, new.assignee_id,
      'Marked "' || new.title || '" as done', '{}'::jsonb);
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform public.write_activity('task.cancelled', 'task', new.id::text, new.assignee_id,
      'Cancelled the task "' || new.title || '"', '{}'::jsonb);
  end if;
  return null;
end;
$$;

create or replace trigger tasks_notify
  after insert or update on public.tasks
  for each row execute function public.notify_tasks();

-- Due-soon and overdue task reminders (sent once each).
create or replace function public.send_task_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Colombo')::date;
  t public.tasks;
begin
  for t in
    select * from public.tasks
    where status = 'open' and due_date is not null and due_date <= today + 1
  loop
    if t.due_date < today then
      perform public.notify(t.assignee_id, 'task.overdue', 'Overdue: ' || t.title,
        'It was due ' || trim(to_char(t.due_date, 'FMDD Mon')) || '. Finish it or tell an admin.',
        public.task_link(t), 'task-overdue:' || t.id::text);
    else
      perform public.notify(t.assignee_id, 'task.due',
        'Due ' || case when t.due_date = today then 'today' else 'tomorrow' end || ': ' || t.title,
        null, public.task_link(t), 'task-due:' || t.id::text || ':' || t.due_date::text);
    end if;
  end loop;
end;
$$;

-- The daily job (and dashboard visits) also send task reminders.
create or replace function public.send_deadline_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings record;
  this_month date := date_trunc('month', now() at time zone 'Asia/Colombo')::date;
  m date;
  due timestamptz;
  days_left integer;
  sent integer := 0;
  pending_count integer;
  person record;
begin
  perform public.send_task_reminders();
  select * into settings from public.app_settings limit 1;

  foreach m in array array[(this_month - interval '1 month')::date, this_month] loop
    continue when exists (select 1 from public.pay_months where month = m);
    due := public.work_deadline(m);
    continue when due is null;

    if now() < due then
      days_left := ceil(extract(epoch from (due - now())) / 86400)::integer;
      continue when days_left > coalesce(settings.reminder_days, 3);
      for person in
        select distinct p.id
        from public.profiles p
        join public.member_roles mr on mr.user_id = p.id
        where p.is_active
      loop
        perform public.notify(
          person.id, 'deadline.reminder',
          'Submit your ' || public.month_name(m) || ' work by ' || public.deadline_label(due),
          case when days_left <= 1 then 'Last day today! '
               else days_left || ' days left. ' end
            || 'Work can''t be added after the deadline.',
          '/work/new?month=' || public.month_key(m),
          'deadline:' || public.month_key(m) || ':' || days_left
        );
        sent := sent + 1;
      end loop;
    elsif now() < due + interval '10 days' then
      select count(*) into pending_count from public.submissions where work_month = m and status = 'pending';
      for person in select id from public.profiles where is_admin and is_active loop
        perform public.notify(
          person.id, 'deadline.passed',
          'The ' || public.month_name(m) || ' deadline has passed',
          case when pending_count > 0
            then pending_count || ' submission' || case when pending_count = 1 then '' else 's' end
                 || ' to review, then close the month in Payments.'
            else 'Everything is reviewed. Close the month in Payments.' end,
          case when pending_count > 0
            then '/admin/review?status=pending&month=' || public.month_key(m)
            else '/admin/payments?month=' || public.month_key(m) end,
          'deadline-passed:' || public.month_key(m)
        );
        sent := sent + 1;
      end loop;
    end if;
  end loop;
  return sent;
end;
$$;

-- -----------------------------------------------------------------------------
-- Private "papers" bucket: <paper_id>/<stage>/v<version>-<file>
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('papers', 'papers', false, 26214400, null) -- 25 MB per file
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

create policy "papers bucket: owners and admins read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'papers'
    and public.can_access_paper(nullif((storage.foldername(name))[1], '')::uuid)
  );

create policy "papers bucket: owners and admins upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'papers'
    and public.can_access_paper(nullif((storage.foldername(name))[1], '')::uuid)
  );

create policy "papers bucket: admins delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'papers' and public.is_admin());

-- -----------------------------------------------------------------------------
-- Function permissions
-- -----------------------------------------------------------------------------
revoke execute on function public.guard_task_changes() from public, anon, authenticated;
revoke execute on function public.check_submission_task() from public, anon, authenticated;
revoke execute on function public.advance_paper(uuid) from public, anon, authenticated;
revoke execute on function public.sync_paper_stage_from_task() from public, anon, authenticated;
revoke execute on function public.task_link(public.tasks) from public, anon, authenticated;
revoke execute on function public.notify_tasks() from public, anon, authenticated;
revoke execute on function public.send_task_reminders() from public, anon, authenticated;

revoke execute on function public.can_access_paper(uuid) from public, anon;
revoke execute on function public.create_paper(text, text, uuid, text, jsonb) from public, anon;
revoke execute on function public.update_paper_stage(uuid, uuid, date, text) from public, anon;
revoke execute on function public.set_paper_status(uuid, text) from public, anon;
grant execute on function public.can_access_paper(uuid) to authenticated;
grant execute on function public.create_paper(text, text, uuid, text, jsonb) to authenticated;
grant execute on function public.update_paper_stage(uuid, uuid, date, text) to authenticated;
grant execute on function public.set_paper_status(uuid, text) to authenticated;
