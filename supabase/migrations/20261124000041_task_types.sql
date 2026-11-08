-- =============================================================================
-- Task types: presets for work that is assigned again and again, e.g.
-- "Upload recording to LMS" with its own fields (Title, Lesson, Video URL…).
-- An admin picks a type, fills in its fields and assigns the task.
--
-- task_types.fields: [{ id, label, kind, required, options }]
--   kind: text | long | link | date | number | select (options = the dropdown list)
-- tasks.details: a copy of the filled-in fields [{ id, label, kind, value }],
--   so renaming or removing a field later doesn't change tasks already given.
--
-- Everyone signed in can read types (members see them on their tasks); only
-- people who can edit the Tasks page can change them. Safe to run twice.
-- =============================================================================

create table if not exists public.task_types (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(trim(name)) between 2 and 60),
  icon                text check (char_length(icon) <= 16),
  description         text check (char_length(description) <= 300),
  role_id             uuid references public.roles (id) on delete set null,
  default_assignee_id uuid references public.profiles (id) on delete set null,
  title_template      text check (char_length(title_template) <= 150),
  due_days            integer check (due_days between 0 and 90),
  priority            text not null default 'normal' check (priority in ('normal', 'high')),
  fields              jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) <= 20),
  active              boolean not null default true,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists task_types_name_unique on public.task_types (lower(trim(name)));
create index if not exists task_types_role_idx on public.task_types (role_id);
create index if not exists task_types_assignee_idx on public.task_types (default_assignee_id);

create or replace trigger task_types_set_updated_at
  before update on public.task_types
  for each row execute function public.set_updated_at();

alter table public.task_types enable row level security;
revoke all on public.task_types from anon;
grant select, insert, update, delete on public.task_types to authenticated;

drop policy if exists "task types: read" on public.task_types;
create policy "task types: read" on public.task_types for select to authenticated
  using ((select public.is_active_member()) or (select public.is_admin()));

drop policy if exists "task types: page editors manage" on public.task_types;
create policy "task types: page editors manage" on public.task_types for all to authenticated
  using ((select public.has_page('tasks', true)))
  with check ((select public.has_page('tasks', true)));

-- Tasks: which type, and the filled-in fields.
alter table public.tasks add column if not exists type_id uuid references public.task_types (id) on delete set null;
alter table public.tasks add column if not exists details jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_details_is_array') then
    alter table public.tasks add constraint tasks_details_is_array
      check (jsonb_typeof(details) = 'array' and jsonb_array_length(details) <= 20);
  end if;
end;
$$;
create index if not exists tasks_type_idx on public.tasks (type_id);

-- Members can still only mark their own task done; the type and fields are admin-only too.
create or replace function public.guard_task_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- current_user is 'authenticated' for direct API calls; inside the paper flow
  -- functions (security definer) it is their owner, which is trusted.
  if (select auth.uid()) is not null and current_user = 'authenticated' and not public.has_page('tasks', true) then
    if new.title is distinct from old.title or new.description is distinct from old.description
       or new.assignee_id is distinct from old.assignee_id or new.role_id is distinct from old.role_id
       or new.exam_id is distinct from old.exam_id or new.centre_id is distinct from old.centre_id
       or new.quantity is distinct from old.quantity or new.due_date is distinct from old.due_date
       or new.priority is distinct from old.priority or new.paper_stage_id is distinct from old.paper_stage_id
       or new.created_by is distinct from old.created_by
       or new.type_id is distinct from old.type_id or new.details is distinct from old.details then
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

revoke execute on function public.guard_task_changes() from public, anon, authenticated;
