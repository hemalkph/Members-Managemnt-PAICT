-- =============================================================================
-- Main admins, work types + payout amounts on submissions, monthly budget,
-- and a notice board. (No DROP statements, so it runs without confirmation.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Main admins: the owners. Only they see Analytics and edit pay rates.
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists is_main_admin boolean not null default false;

alter table public.profiles
  add constraint profiles_main_admin_is_admin check (not is_main_admin or is_admin);

create or replace function public.is_main_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_admin and is_main_admin and is_active
  );
$$;

revoke execute on function public.is_main_admin() from public, anon;
grant execute on function public.is_main_admin() to authenticated, service_role;

-- Members can't change admin flags; only main admins can change main-admin status.
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
    elsif new.is_main_admin is distinct from old.is_main_admin and not public.is_main_admin() then
      raise exception 'Only main admins can change main admin status' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Pay rates: every admin can read them, only main admins can change them.
alter policy "rate_items: admins manage" on public.rate_items
  using (public.is_main_admin())
  with check (public.is_main_admin());

create policy "rate_items: admins read"
  on public.rate_items for select to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- Work type + amount on submissions
--   unit_price is copied from the rate item. While a submission is pending it
--   follows the current price; once approved the price is locked, so later
--   price changes don't rewrite past spending.
-- -----------------------------------------------------------------------------
alter table public.submissions
  add column if not exists rate_item_id uuid references public.rate_items (id) on delete set null;
alter table public.submissions
  add column if not exists unit_price numeric(12, 2);
alter table public.submissions
  add column if not exists amount numeric(14, 2) generated always as (quantity * unit_price) stored;

create index if not exists submissions_rate_item_id_idx on public.submissions (rate_item_id);

create or replace function public.set_submission_unit_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_role uuid;
  item_price numeric(12, 2);
  locked boolean := tg_op = 'UPDATE' and old.status = 'approved' and new.status = 'approved';
begin
  if new.rate_item_id is null then
    -- Keep the locked price of approved work (e.g. when its category is deleted).
    if not locked then new.unit_price := null; end if;
    return new;
  end if;

  select role_id, price into item_role, item_price
  from public.rate_items where id = new.rate_item_id;

  if not found then
    new.rate_item_id := null;
    if not locked then new.unit_price := null; end if;
    return new;
  end if;

  if item_role <> new.role_id then
    raise exception 'That work type does not belong to the chosen role' using errcode = '23514';
  end if;

  if not locked or new.rate_item_id is distinct from old.rate_item_id or old.unit_price is null then
    new.unit_price := item_price;
  end if;
  return new;
end;
$$;

-- Runs after submissions_guard_changes (triggers fire in name order).
create or replace trigger submissions_set_unit_price
  before insert or update on public.submissions
  for each row execute function public.set_submission_unit_price();

-- -----------------------------------------------------------------------------
-- Monthly budget (one settings row)
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  id             boolean primary key default true check (id),
  monthly_budget numeric(14, 2) not null default 0 check (monthly_budget >= 0 and monthly_budget <= 1000000000),
  updated_by     uuid references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now()
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

create or replace trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;

create policy "app_settings: admins read"
  on public.app_settings for select to authenticated
  using (public.is_admin());

create policy "app_settings: main admins update"
  on public.app_settings for update to authenticated
  using (public.is_main_admin())
  with check (public.is_main_admin());

-- -----------------------------------------------------------------------------
-- Notice board
-- -----------------------------------------------------------------------------
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(trim(title)) between 2 and 120),
  body       text check (char_length(body) <= 2000),
  pinned     boolean not null default false,
  expires_on date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_created_at_idx on public.announcements (created_at desc);
create index if not exists announcements_created_by_idx on public.announcements (created_by);

create or replace trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

alter table public.announcements enable row level security;
revoke all on public.announcements from anon;

create policy "announcements: members read current"
  on public.announcements for select to authenticated
  using (public.is_active_member() and (expires_on is null or expires_on >= current_date));

create policy "announcements: admins manage"
  on public.announcements for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- The trigger function is only meant to run as a trigger.
revoke execute on function public.set_submission_unit_price() from public, anon, authenticated;
