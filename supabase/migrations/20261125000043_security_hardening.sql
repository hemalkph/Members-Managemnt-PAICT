-- =============================================================================
-- Security hardening (from the security audit, run 1). Safe to run twice.
--
-- 1. Two-step login is enforced by the database, not only by the app.
--    Someone who turned on an authenticator app must have entered the code
--    (an aal2 session) before any admin power or page grant works, and before
--    their own bank details, salaries and payslips can be read. A stolen
--    password alone (aal1), used directly against the database API, gets none
--    of these. People without two-step are unchanged.
-- 2. Only main admins can deactivate, edit or delete a main admin.
-- 3. Approving or rejecting work needs edit access to Work review (page
--    access), and ordinary admins can't review their own work. This also
--    covers admins inserting work that is already approved.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Two-step done, or not turned on
-- -----------------------------------------------------------------------------
create or replace function public.two_step_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
      or not exists (
        select 1
        from auth.mfa_factors f
        where f.user_id = (select auth.uid())
          and f.status::text = 'verified'
      );
$$;

revoke execute on function public.two_step_ok() from public, anon;
grant execute on function public.two_step_ok() to authenticated, service_role;

-- Admin powers need the two-step code when the admin has turned it on.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_admin and is_active
  ) and public.two_step_ok();
$$;

-- Page access: the same rule for every admin (main admins included); members
-- given a page still need two-step itself.
create or replace function public.has_page(p_page text, p_edit boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when not public.two_step_ok() then false
      when p.is_admin and p.is_main_admin then true
      when p.is_admin then
        case coalesce(p.page_access ->> p_page, 'edit')
          when 'edit' then true
          when 'view' then not p_edit
          else false
        end
      when p_page = any (array['papers', 'tasks', 'classes', 'notices', 'dispatch'])
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

-- A person's own pay and bank data also need the code when two-step is on
-- (restrictive: added on top of the existing owner/admin rules).
drop policy if exists "bank: two-step done" on public.bank_details;
create policy "bank: two-step done"
  on public.bank_details as restrictive for all to authenticated
  using ((select public.two_step_ok()))
  with check ((select public.two_step_ok()));

drop policy if exists "salaries: two-step done" on public.member_salaries;
create policy "salaries: two-step done"
  on public.member_salaries as restrictive for all to authenticated
  using ((select public.two_step_ok()))
  with check ((select public.two_step_ok()));

drop policy if exists "payouts: two-step done" on public.payouts;
create policy "payouts: two-step done"
  on public.payouts as restrictive for select to authenticated
  using ((select public.two_step_ok()));

-- -----------------------------------------------------------------------------
-- 2. Main admins' accounts: only main admins can change or remove them
-- -----------------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if not public.is_admin() then
      if new.is_admin is distinct from old.is_admin
         or new.is_main_admin is distinct from old.is_main_admin
         or new.is_active is distinct from old.is_active
         or new.email is distinct from old.email
         or new.id is distinct from old.id then
        raise exception 'Only admins can change admin status, active status or email'
          using errcode = '42501';
      end if;
    elsif not public.is_main_admin() then
      if new.is_main_admin is distinct from old.is_main_admin then
        raise exception 'Only main admins can change main admin status' using errcode = '42501';
      end if;
      -- An ordinary admin can't deactivate, demote or re-address a main admin.
      if old.is_main_admin
         and (new.is_active is distinct from old.is_active
              or new.is_admin is distinct from old.is_admin
              or new.email is distinct from old.email) then
        raise exception 'Only main admins can change a main admin''s account' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists "profiles: admins delete" on public.profiles;
create policy "profiles: admins delete"
  on public.profiles for delete to authenticated
  using (public.is_admin() and (not is_main_admin or public.is_main_admin()));

-- -----------------------------------------------------------------------------
-- 3. Reviewing work: Work review edit access, and no self-review
-- -----------------------------------------------------------------------------
create or replace function public.guard_submission_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  acting_user uuid := (select auth.uid());
  reviewing boolean;
begin
  -- SQL editor / service role (no auth.uid()) is trusted.
  if acting_user is null then
    return new;
  end if;

  if public.is_admin() then
    -- A review is any status or comment change, or adding work that is not pending.
    reviewing := case
      when tg_op = 'INSERT' then new.status <> 'pending' or new.admin_comment is not null
      else new.status is distinct from old.status or new.admin_comment is distinct from old.admin_comment
    end;
    if reviewing then
      if not public.has_page('review', true) then
        raise exception 'You need edit access to Work review to review work' using errcode = '42501';
      end if;
      if new.user_id = acting_user and not public.is_main_admin() then
        raise exception 'You can''t review your own work. Ask another admin.' using errcode = '42501';
      end if;
    end if;
    if tg_op = 'INSERT' then
      if new.status = 'pending' then
        new.reviewed_by := null;
        new.reviewed_at := null;
      else
        new.reviewed_by := acting_user;
        new.reviewed_at := now();
      end if;
    elsif new.status is distinct from old.status then
      if new.status = 'pending' then
        new.reviewed_by := null;
        new.reviewed_at := null;
      else
        new.reviewed_by := acting_user;
        new.reviewed_at := now();
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.admin_comment := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;

  -- UPDATE by a member
  if old.status <> 'pending' then
    raise exception 'Only pending submissions can be edited' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     or new.admin_comment is distinct from old.admin_comment
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.user_id is distinct from old.user_id then
    raise exception 'Members cannot change review fields' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_submission_changes() from public, anon, authenticated;
revoke execute on function public.protect_profile_columns() from public, anon, authenticated;
