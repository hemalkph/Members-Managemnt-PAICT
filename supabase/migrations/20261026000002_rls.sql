-- =============================================================================
-- Row Level Security
-- Members: only their own profile, bank details, roles and submissions.
-- Admins (profiles.is_admin and active): everything.
-- The anon role gets nothing: every policy is "to authenticated".
-- =============================================================================

alter table public.profiles               enable row level security;
alter table public.bank_details           enable row level security;
alter table public.sections               enable row level security;
alter table public.roles                  enable row level security;
alter table public.member_roles           enable row level security;
alter table public.submissions            enable row level security;
alter table public.submission_attachments enable row level security;

revoke all on public.profiles, public.bank_details, public.member_roles,
  public.submissions, public.submission_attachments, public.sections, public.roles,
  public.approved_work_summary
  from anon;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: admins read all"
  on public.profiles for select to authenticated
  using (public.is_admin());

-- Column protection (is_admin / is_active / email) is enforced by the
-- profiles_protect_columns trigger.
create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "profiles: admins update all"
  on public.profiles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Profiles are created by the auth trigger; deleting happens via auth.users.
create policy "profiles: admins delete"
  on public.profiles for delete to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- bank_details (owner + admins only)
-- -----------------------------------------------------------------------------
create policy "bank: owner reads"
  on public.bank_details for select to authenticated
  using (user_id = (select auth.uid()));

create policy "bank: owner inserts"
  on public.bank_details for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_active_member());

create policy "bank: owner updates"
  on public.bank_details for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_active_member());

create policy "bank: owner deletes"
  on public.bank_details for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "bank: admins manage"
  on public.bank_details for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- sections & roles: every signed-in user can read; admins write
-- -----------------------------------------------------------------------------
create policy "sections: signed-in users read"
  on public.sections for select to authenticated
  using (true);

create policy "sections: admins insert"
  on public.sections for insert to authenticated
  with check (public.is_admin());

create policy "sections: admins update"
  on public.sections for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "sections: admins delete"
  on public.sections for delete to authenticated
  using (public.is_admin());

create policy "roles: signed-in users read"
  on public.roles for select to authenticated
  using (true);

create policy "roles: admins insert"
  on public.roles for insert to authenticated
  with check (public.is_admin());

create policy "roles: admins update"
  on public.roles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "roles: admins delete"
  on public.roles for delete to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- member_roles: members read their own; only admins assign
-- -----------------------------------------------------------------------------
create policy "member_roles: read own"
  on public.member_roles for select to authenticated
  using (user_id = (select auth.uid()));

create policy "member_roles: admins manage"
  on public.member_roles for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- submissions
-- Review fields and "pending only" edits are also guarded by a trigger.
-- -----------------------------------------------------------------------------
create policy "submissions: read own"
  on public.submissions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "submissions: insert own for an assigned role"
  on public.submissions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and public.is_active_member()
    and exists (
      select 1 from public.member_roles mr
      where mr.user_id = (select auth.uid()) and mr.role_id = submissions.role_id
    )
  );

create policy "submissions: update own while pending"
  on public.submissions for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and public.is_active_member()
    and exists (
      select 1 from public.member_roles mr
      where mr.user_id = (select auth.uid()) and mr.role_id = submissions.role_id
    )
  );

create policy "submissions: delete own while pending"
  on public.submissions for delete to authenticated
  using (user_id = (select auth.uid()) and status = 'pending');

create policy "submissions: admins manage"
  on public.submissions for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- submission_attachments
-- -----------------------------------------------------------------------------
create policy "attachments: read own"
  on public.submission_attachments for select to authenticated
  using (user_id = (select auth.uid()));

create policy "attachments: add to own pending submission"
  on public.submission_attachments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and storage_path like (select auth.uid())::text || '/%'
    and exists (
      select 1 from public.submissions s
      where s.id = submission_attachments.submission_id
        and s.user_id = (select auth.uid())
        and s.status = 'pending'
    )
  );

create policy "attachments: remove from own pending submission"
  on public.submission_attachments for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.submissions s
      where s.id = submission_attachments.submission_id
        and s.user_id = (select auth.uid())
        and s.status = 'pending'
    )
  );

create policy "attachments: admins manage"
  on public.submission_attachments for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
