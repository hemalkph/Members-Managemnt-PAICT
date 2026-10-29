-- =============================================================================
-- Page access per account (safe to run more than once)
--
-- profiles.page_access: null = the defaults for the account type, otherwise a
-- map of page key -> 'edit' | 'view' | 'none'.
--   Main admins: every page, always (their map is ignored).
--   Admins:      every admin page by default; a map can turn a page off or
--                make it read only.
--   Members:     no admin pages by default. Only Papers, Tasks, Batches &
--                exams and Notice board can be given to a member, and only
--                after they entered their two-step login code (aal2).
-- Only main admins can change page_access, and every change is logged.
-- =============================================================================

alter table public.profiles add column if not exists page_access jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_page_access_is_object') then
    alter table public.profiles
      add constraint profiles_page_access_is_object
      check (page_access is null or jsonb_typeof(page_access) = 'object');
  end if;
end;
$$;

comment on column public.profiles.page_access is
  'null = defaults for the account type; else {page: edit|view|none}. Only main admins can change it.';

-- -----------------------------------------------------------------------------
-- Does the signed-in user have this page (p_edit: with edit rights)?
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
      when p_page = any (array['papers', 'tasks', 'classes', 'notices'])
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
-- Only main admins can change page access; every change goes to the activity log.
-- -----------------------------------------------------------------------------
create or replace function public.guard_page_access()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.page_access is distinct from old.page_access
     and (select auth.uid()) is not null
     and not public.is_main_admin() then
    raise exception 'Only main admins can change page access' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace trigger profiles_guard_page_access
  before update of page_access on public.profiles
  for each row execute function public.guard_page_access();

create or replace function public.audit_page_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.page_access is distinct from old.page_access then
    perform public.write_activity(
      'member.page_access', 'member', new.id::text, new.id,
      'Changed page access for ' || coalesce(nullif(trim(new.full_name), ''), new.email),
      jsonb_build_object('before', old.page_access, 'after', new.page_access));
  end if;
  return null;
end;
$$;

create or replace trigger profiles_audit_page_access
  after update of page_access on public.profiles
  for each row execute function public.audit_page_access();

revoke execute on function public.guard_page_access() from public, anon, authenticated;
revoke execute on function public.audit_page_access() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Names (and, for editors, contact numbers) of the team, for people with the
-- Papers or Tasks page. Members can't read other profiles directly, so NIC,
-- birthday and bank details stay private.
-- -----------------------------------------------------------------------------
create or replace function public.team_directory()
returns table (id uuid, name text, email text, phone text, whatsapp text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select
      public.is_admin() or public.has_page('papers', true) or public.has_page('tasks', true) as contacts,
      public.is_admin() or public.has_page('papers') or public.has_page('tasks') as allowed
  )
  select p.id,
         coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)),
         case when me.contacts then p.email end,
         case when me.contacts then p.phone end,
         case when me.contacts then p.whatsapp end,
         p.is_active
  from public.profiles p, me
  where me.allowed
  order by 2;
$$;

revoke execute on function public.team_directory() from public, anon;
grant execute on function public.team_directory() to authenticated;

-- Paper settings shown on the Papers page (not the whole app_settings row,
-- which also holds the budget).
create or replace function public.paper_settings()
returns table (paper_file_days integer, paper_default_owners jsonb, lms_group_link text, physical_group_link text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.paper_file_days, s.paper_default_owners, s.lms_group_link, s.physical_group_link
  from public.app_settings s
  where public.has_page('papers')
  limit 1;
$$;

revoke execute on function public.paper_settings() from public, anon;
grant execute on function public.paper_settings() to authenticated;

-- -----------------------------------------------------------------------------
-- Papers: people with the Papers page see every paper, its stages, files and notes.
-- -----------------------------------------------------------------------------
create or replace function public.can_access_paper(p_paper uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or public.has_page('papers')
      or (public.is_active_member() and exists (
            select 1 from public.paper_stages
            where paper_id = p_paper and owner_id = (select auth.uid())
          ));
$$;

-- Writing (notes, uploads) needs more than looking: admins, Papers editors,
-- or someone who owns a stage. Read-only viewers can't write.
create or replace function public.can_work_on_paper(p_paper uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or public.has_page('papers', true)
      or (public.is_active_member() and exists (
            select 1 from public.paper_stages
            where paper_id = p_paper and owner_id = (select auth.uid())
          ));
$$;

revoke execute on function public.can_work_on_paper(uuid) from public, anon;
grant execute on function public.can_work_on_paper(uuid) to authenticated;

drop policy if exists "paper_notes: people on the paper write" on public.paper_notes;
create policy "paper_notes: people on the paper write" on public.paper_notes for insert to authenticated
  with check (author_id = (select auth.uid()) and public.is_active_member() and public.can_work_on_paper(paper_id));

drop policy if exists "papers bucket: owners and admins upload" on storage.objects;
create policy "papers bucket: owners and admins upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'papers'
    and public.can_work_on_paper(nullif((storage.foldername(name))[1], '')::uuid)
  );

drop policy if exists "paper_files: page editors add" on public.paper_files;
create policy "paper_files: page editors add" on public.paper_files for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and storage_path like paper_id::text || '/' || stage || '/%'
    and (select public.has_page('papers', true))
  );

drop policy if exists "paper_files: page editors delete" on public.paper_files;
create policy "paper_files: page editors delete" on public.paper_files for delete to authenticated
  using ((select public.has_page('papers', true)));

drop policy if exists "papers bucket: page editors delete" on storage.objects;
create policy "papers bucket: page editors delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'papers' and (select public.has_page('papers', true)));

-- The paper functions now check the Papers page (edit) instead of "is admin",
-- so a read-only admin can't change papers either. Patches the live function
-- text, so later changes to these functions are kept.
do $$
declare
  fix record;
  fn record;
  def text;
begin
  for fix in
    select * from (values
      ('create_paper',             'public.is_admin()', 'public.has_page(''papers'', true)'),
      ('update_paper_stage',       'public.is_admin()', 'public.has_page(''papers'', true)'),
      ('set_paper_status',         'public.is_admin()', 'public.has_page(''papers'', true)'),
      ('set_paper_links',          'public.is_admin()', 'public.has_page(''papers'', true)'),
      ('set_stage_link',           'public.is_admin()', 'public.has_page(''papers'', true)'),
      ('set_group_links',          'public.is_admin()', 'public.has_page(''papers'', true)'),
      ('set_paper_default_owners', 'public.is_admin()', 'public.has_page(''papers'', true)'),
      ('storage_usage',            'public.is_admin()', 'public.has_page(''papers'')'),
      ('guard_task_changes',       'public.is_admin()', 'public.has_page(''tasks'', true)')
    ) as v(fname, old_text, new_text)
  loop
    for fn in
      select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fix.fname
    loop
      def := pg_get_functiondef(fn.oid);
      if position(fix.old_text in def) > 0 then
        execute replace(def, fix.old_text, fix.new_text);
        raise notice 'Updated %', fix.fname;
      end if;
    end loop;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tasks: read with the Tasks page (or Papers, for the workload check),
-- manage with Tasks edit.
-- -----------------------------------------------------------------------------
drop policy if exists "tasks: page access read" on public.tasks;
create policy "tasks: page access read" on public.tasks for select to authenticated
  using ((select public.has_page('tasks')) or (select public.has_page('papers')));

drop policy if exists "tasks: page editors insert" on public.tasks;
create policy "tasks: page editors insert" on public.tasks for insert to authenticated
  with check ((select public.has_page('tasks', true)));

drop policy if exists "tasks: page editors update" on public.tasks;
create policy "tasks: page editors update" on public.tasks for update to authenticated
  using ((select public.has_page('tasks', true)))
  with check ((select public.has_page('tasks', true)));

drop policy if exists "tasks: page editors delete" on public.tasks;
create policy "tasks: page editors delete" on public.tasks for delete to authenticated
  using ((select public.has_page('tasks', true)));

-- Who holds which role (to suggest assignees). Not sensitive.
drop policy if exists "member_roles: task editors read" on public.member_roles;
create policy "member_roles: task editors read" on public.member_roles for select to authenticated
  using ((select public.has_page('tasks', true)));

-- -----------------------------------------------------------------------------
-- Batches & exams
-- -----------------------------------------------------------------------------
drop policy if exists "batches: page editors manage" on public.batches;
create policy "batches: page editors manage" on public.batches for all to authenticated
  using ((select public.has_page('classes', true))) with check ((select public.has_page('classes', true)));
drop policy if exists "exams: page editors manage" on public.exams;
create policy "exams: page editors manage" on public.exams for all to authenticated
  using ((select public.has_page('classes', true))) with check ((select public.has_page('classes', true)));
drop policy if exists "centres: page editors manage" on public.centres;
create policy "centres: page editors manage" on public.centres for all to authenticated
  using ((select public.has_page('classes', true))) with check ((select public.has_page('classes', true)));

-- -----------------------------------------------------------------------------
-- Notice board
-- -----------------------------------------------------------------------------
drop policy if exists "announcements: page access read" on public.announcements;
create policy "announcements: page access read" on public.announcements for select to authenticated
  using ((select public.has_page('notices')));
drop policy if exists "announcements: page editors manage" on public.announcements;
create policy "announcements: page editors manage" on public.announcements for all to authenticated
  using ((select public.has_page('notices', true))) with check ((select public.has_page('notices', true)));
