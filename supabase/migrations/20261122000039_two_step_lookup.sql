-- =============================================================================
-- Faster page loads: the app checks the login token itself instead of asking
-- Supabase Auth on every page. It still needs to know whether the signed-in
-- user has turned on an authenticator app (to ask for the code), so it reads
-- that here, fresh, in the same trip as the profile. Safe to run twice.
-- =============================================================================

create or replace function public.my_two_step_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.mfa_factors f
    where f.user_id = (select auth.uid())
      and f.factor_type::text = 'totp'
      and f.status::text = 'verified'
  );
$$;

revoke execute on function public.my_two_step_on() from public, anon;
grant execute on function public.my_two_step_on() to authenticated;
