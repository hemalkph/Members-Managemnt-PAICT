-- Lock down SECURITY DEFINER helper functions (Supabase security advisor).
-- handle_new_user only runs as a trigger, so nobody needs to call it directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- is_admin / is_active_member are used inside RLS policies for signed-in users,
-- so authenticated keeps EXECUTE; anonymous visitors get nothing.
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_active_member() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_member() to authenticated;
