-- =============================================================================
-- Security hardening, part 2. Safe to run twice.
--
-- 1. Every admin needs the two-step code (an aal2 session) for admin powers
--    and page access, not only main admins. An admin without two-step sets it
--    up first (the app sends them to Two-step login).
-- 2. Bank details: admins can read them; only main admins can add, change or
--    delete someone else's. Members still manage their own.
-- 3. Phone notifications belong to one login session: they are saved with the
--    session they were turned on in, removed at sign-out, and only sent to
--    phones whose login session is still alive. A phone moves to whoever turns
--    alerts on next.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Admin powers need the two-step code
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
     and exists (
       select 1 from public.profiles
       where id = (select auth.uid()) and is_admin and is_active
     );
$$;

create or replace function public.has_page(p_page text, p_edit boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then false
      when p.is_admin and p.is_main_admin then true
      when p.is_admin then
        case coalesce(p.page_access ->> p_page, 'edit')
          when 'edit' then true
          when 'view' then not p_edit
          else false
        end
      when p_page = any (array['papers', 'tasks', 'classes', 'notices', 'dispatch']) then
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

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
revoke execute on function public.has_page(text, boolean) from public, anon;
grant execute on function public.has_page(text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Bank details: admins read, main admins manage
-- -----------------------------------------------------------------------------
drop policy if exists "bank: admins manage" on public.bank_details;

drop policy if exists "bank: admins read" on public.bank_details;
create policy "bank: admins read"
  on public.bank_details for select to authenticated
  using (public.is_admin());

drop policy if exists "bank: main admins manage" on public.bank_details;
create policy "bank: main admins manage"
  on public.bank_details for all to authenticated
  using (public.is_main_admin())
  with check (public.is_main_admin());

-- -----------------------------------------------------------------------------
-- 3. Phone notifications follow the login session
-- -----------------------------------------------------------------------------
alter table public.push_subscriptions add column if not exists session_id uuid;
create index if not exists push_subscriptions_session_idx on public.push_subscriptions (session_id);

-- Saving always goes through push_subscription_save, so every row has its session.
revoke insert on public.push_subscriptions from authenticated;

create or replace function public.push_subscription_save(p_endpoint text, p_p256dh text, p_auth text, p_device text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  sess uuid := nullif((select auth.jwt() ->> 'session_id'), '')::uuid;
begin
  if me is null or sess is null or not public.is_active_member() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  -- The phone may have been someone else's before: it moves to whoever turns alerts on now.
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device, session_id)
  values (me, p_endpoint, p_p256dh, p_auth, nullif(trim(p_device), ''), sess);
end;
$$;

-- Link this phone to the current login session again (same person only).
-- Returns false when the phone isn't saved for this person.
create or replace function public.push_subscription_refresh(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  sess uuid := nullif((select auth.jwt() ->> 'session_id'), '')::uuid;
begin
  if me is null or sess is null then
    return false;
  end if;
  update public.push_subscriptions
     set session_id = sess
   where endpoint = p_endpoint and user_id = me;
  return found;
end;
$$;

-- The phones a notification may go to: only those whose login session is still alive.
-- The server (service role) asks for anyone; a signed-in person only for themselves.
create or replace function public.live_push_subscriptions(p_user uuid)
returns table (id uuid, endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  join auth.sessions a on a.id = s.session_id and a.user_id = s.user_id
  where s.user_id = p_user
    and ((select auth.uid()) is null or (select auth.uid()) = p_user)
    and (a.not_after is null or a.not_after > now());
$$;

revoke execute on function public.push_subscription_save(text, text, text, text) from public, anon;
revoke execute on function public.push_subscription_refresh(text) from public, anon;
revoke execute on function public.live_push_subscriptions(uuid) from public, anon;
grant execute on function public.push_subscription_save(text, text, text, text) to authenticated;
grant execute on function public.push_subscription_refresh(text) to authenticated;
grant execute on function public.live_push_subscriptions(uuid) to authenticated, service_role;
