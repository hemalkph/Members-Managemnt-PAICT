-- Task files. Safe to run twice.
--   * Admins (Tasks edit) attach files to a task – the brief, e.g. type setting
--     or design material – when they assign it or any time later.
--   * The member uploads their finished work, as many files as the task needs.
--   * A file is "new" until the other side opens it (seen_at).
-- Paper stage tasks keep using the paper page's files.

create table if not exists public.task_files (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks (id) on delete cascade,
  kind         text not null check (kind in ('brief', 'work')),
  storage_path text not null unique check (char_length(storage_path) between 3 and 400),
  file_name    text not null check (char_length(file_name) between 1 and 200),
  mime_type    text check (char_length(mime_type) <= 150),
  size_bytes   bigint not null check (size_bytes > 0),
  uploaded_by  uuid references public.profiles (id) on delete set null,
  seen_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists task_files_task_idx on public.task_files (task_id, kind, created_at);
create index if not exists task_files_uploaded_by_idx on public.task_files (uploaded_by);

alter table public.task_files enable row level security;
revoke all on public.task_files from anon;

-- Who may add (and remove) a file of this kind: Tasks editors add the brief,
-- the assignee adds work while the task is open or done.
create or replace function public.can_add_task_file(p_task uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and t.paper_stage_id is null
      and (
        (p_kind = 'brief' and public.has_page('tasks', true))
        or (p_kind = 'work' and t.assignee_id = (select auth.uid())
            and t.status in ('open', 'done') and public.is_active_member())
      )
  );
$$;
revoke execute on function public.can_add_task_file(uuid, text) from public, anon;
grant execute on function public.can_add_task_file(uuid, text) to authenticated;

-- Anyone who can see the task (tasks RLS) sees its files.
drop policy if exists "task_files: read with the task" on public.task_files;
create policy "task_files: read with the task" on public.task_files for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists "task_files: add" on public.task_files;
create policy "task_files: add" on public.task_files for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and storage_path like task_id::text || '/' || kind || '/%'
    and public.can_add_task_file(task_id, kind)
  );

drop policy if exists "task_files: remove" on public.task_files;
create policy "task_files: remove" on public.task_files for delete to authenticated
  using (
    (select public.has_page('tasks', true))
    or (uploaded_by = (select auth.uid()) and public.can_add_task_file(task_id, kind))
  );

-- The other side opened the file: the assignee opens a brief, a Tasks viewer
-- opens the member's work. No direct UPDATE for anyone.
create or replace function public.task_file_seen(p_file uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.task_files f
  set seen_at = now()
  from public.tasks t
  where f.id = p_file
    and t.id = f.task_id
    and f.seen_at is null
    and f.uploaded_by is distinct from (select auth.uid())
    and case f.kind
          when 'brief' then t.assignee_id = (select auth.uid())
          else t.assignee_id <> (select auth.uid()) and public.has_page('tasks')
        end;
$$;
revoke execute on function public.task_file_seen(uuid) from public, anon;
grant execute on function public.task_file_seen(uuid) to authenticated;

-- One alert per task per hour, so a batch of files is one message. Files sent
-- with a brand-new task come with the "New task" alert instead.
create or replace function public.notify_task_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  hour_key text := to_char(now(), 'YYYYMMDDHH24');
begin
  select * into t from public.tasks where id = new.task_id;
  if not found then
    return null;
  end if;
  if new.kind = 'brief' then
    if t.status in ('open', 'waiting') and new.uploaded_by is distinct from t.assignee_id
       and new.created_at > t.created_at + interval '10 minutes' then
      perform public.notify(t.assignee_id, 'task.files', 'New files for: ' || t.title,
        'Open the task to see them.', '/tasks', 'task-files:' || t.id::text || ':' || hour_key);
    end if;
  elsif t.created_by is not null and t.created_by is distinct from new.uploaded_by then
    perform public.notify(t.created_by, 'task.files',
      coalesce(public.profile_name(t.assignee_id), 'A member') || ' added work to: ' || t.title,
      null, '/admin/tasks', 'task-work:' || t.id::text || ':' || hour_key);
  end if;
  return null;
end;
$$;
revoke execute on function public.notify_task_files() from public, anon, authenticated;

create or replace trigger task_files_notify
  after insert on public.task_files
  for each row execute function public.notify_task_files();

-- -----------------------------------------------------------------------------
-- Storage: private bucket, folders <task id>/<brief|work>/<file>
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tasks', 'tasks', false, 52428800, null) -- 50 MB per file
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "tasks bucket: read with the task" on storage.objects;
create policy "tasks bucket: read with the task"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tasks'
    and exists (select 1 from public.tasks t where t.id::text = (storage.foldername(name))[1])
  );

drop policy if exists "tasks bucket: add" on storage.objects;
create policy "tasks bucket: add"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tasks'
    and public.can_add_task_file(nullif((storage.foldername(name))[1], '')::uuid, (storage.foldername(name))[2])
  );

drop policy if exists "tasks bucket: remove" on storage.objects;
create policy "tasks bucket: remove"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tasks'
    and (
      (select public.has_page('tasks', true))
      or public.can_add_task_file(nullif((storage.foldername(name))[1], '')::uuid, (storage.foldername(name))[2])
    )
  );
