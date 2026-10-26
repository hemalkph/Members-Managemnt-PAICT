-- =============================================================================
-- Fixed monthly salaries for members in salaried roles (e.g. WhatsApp Admin,
-- LMS Admin). One amount per member per role. Main admins manage them;
-- other admins can read them; members can read their own.
-- (No DROP statements, so it runs without confirmation.)
-- =============================================================================

create table if not exists public.member_salaries (
  user_id        uuid not null references public.profiles (id) on delete cascade,
  role_id        uuid not null references public.roles (id) on delete cascade,
  monthly_amount numeric(12, 2) not null default 0 check (monthly_amount >= 0 and monthly_amount <= 10000000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index if not exists member_salaries_role_id_idx on public.member_salaries (role_id);

create or replace trigger member_salaries_set_updated_at
  before update on public.member_salaries
  for each row execute function public.set_updated_at();

alter table public.member_salaries enable row level security;
revoke all on public.member_salaries from anon;

create policy "member_salaries: read own"
  on public.member_salaries for select to authenticated
  using (user_id = (select auth.uid()));

create policy "member_salaries: admins read"
  on public.member_salaries for select to authenticated
  using (public.is_admin());

create policy "member_salaries: main admins manage"
  on public.member_salaries for all to authenticated
  using (public.is_main_admin())
  with check (public.is_main_admin());
