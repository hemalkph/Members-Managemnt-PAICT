-- =============================================================================
-- Security hardening, part 3: lock admin promotion and profile edits.
-- Safe to run more than once.
--
-- 1. Only main admins can grant or revoke is_admin, or edit a main admin's
--    profile at all. Previously an ordinary admin could promote a member (or
--    create a new admin) with default page_access, bypassing restrictions on
--    their own account.
-- 2. Updating or deleting other people's profiles requires edit access to the
--    Members page (has_page('members', true)), not just is_admin().
-- =============================================================================

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
      if new.is_admin is distinct from old.is_admin then
        raise exception 'Only main admins can change admin access' using errcode = '42501';
      end if;
      if old.is_main_admin then
        raise exception 'Only main admins can change a main admin''s account' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_profile_columns() from public, anon, authenticated;

drop policy if exists "profiles: admins update all" on public.profiles;
create policy "profiles: admins update all"
  on public.profiles for update to authenticated
  using (public.has_page('members', true))
  with check (public.has_page('members', true));

drop policy if exists "profiles: admins delete" on public.profiles;
create policy "profiles: admins delete"
  on public.profiles for delete to authenticated
  using (public.has_page('members', true) and (not is_main_admin or public.is_main_admin()));
