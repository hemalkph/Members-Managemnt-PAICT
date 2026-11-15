-- =============================================================================
-- Quick text templates: each member keeps their own short remarks (e.g.
-- "Diagram for Q", "Fixed Q") and adds them to a file with one tap.
-- Only the owner sees and changes their templates. Safe to run more than once.
-- =============================================================================

create table if not exists public.text_templates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now(),
  unique (user_id, body)
);
create index if not exists text_templates_user_idx on public.text_templates (user_id, created_at);

alter table public.text_templates enable row level security;
revoke all on public.text_templates from anon;
revoke update, truncate on public.text_templates from authenticated;
grant select, insert, delete on public.text_templates to authenticated;

drop policy if exists "text_templates: own read" on public.text_templates;
create policy "text_templates: own read" on public.text_templates for select to authenticated
  using (user_id = (select auth.uid()));

-- Up to 30 each, so the list stays quick to scan. Counted outside the policy
-- (a policy reading its own table would loop).
create or replace function public.my_text_template_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.text_templates where user_id = (select auth.uid());
$$;
revoke all on function public.my_text_template_count() from public, anon;
grant execute on function public.my_text_template_count() to authenticated;

drop policy if exists "text_templates: own add" on public.text_templates;
create policy "text_templates: own add" on public.text_templates for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_active_member()
    and public.my_text_template_count() < 30
  );

drop policy if exists "text_templates: own delete" on public.text_templates;
create policy "text_templates: own delete" on public.text_templates for delete to authenticated
  using (user_id = (select auth.uid()));
