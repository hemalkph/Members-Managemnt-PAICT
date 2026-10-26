-- =============================================================================
-- Team Work Tracker — core schema
-- Organisation: sections > roles. Members can hold many roles (member_roles).
-- Members log monthly work (submissions) that admins review.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type public.submission_status as enum ('pending', 'approved', 'rejected');

-- -----------------------------------------------------------------------------
-- Shared trigger: keep updated_at fresh
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Profiles (one row per auth user). Bank details live in their own table.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text not null default '' check (char_length(full_name) <= 120),
  phone       text check (char_length(phone) <= 20),
  whatsapp    text check (char_length(whatsapp) <= 20),
  nic         text check (char_length(nic) <= 12),
  avatar_path text,
  is_admin    boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'Member profile. Set is_admin = true manually to create the first admin.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Is the current user an active admin? SECURITY DEFINER so policies can call it
-- without recursing into the profiles RLS policies.
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
  );
$$;

-- Is the current user an active (not deactivated) member?
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_active
  );
$$;

-- Create a profile automatically whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Members may edit their own contact details, but never their own
-- admin flag, active flag, or email. (SQL editor / service role have no
-- auth.uid(), so they are allowed — that is how the first admin is created.)
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    if new.is_admin is distinct from old.is_admin
       or new.is_active is distinct from old.is_active
       or new.email is distinct from old.email
       or new.id is distinct from old.id then
      raise exception 'Only admins can change admin status, active status or email'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- -----------------------------------------------------------------------------
-- Bank details (separate table, owner + admins only)
-- -----------------------------------------------------------------------------
create table public.bank_details (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  bank_name      text not null check (char_length(bank_name) between 2 and 80),
  branch         text not null check (char_length(branch) between 2 and 80),
  account_holder text not null check (char_length(account_holder) between 2 and 120),
  account_number text not null check (account_number ~ '^[0-9]{4,20}$'),
  -- Last four digits, so pages can show ****1234 without reading the full number.
  account_last4  text generated always as (right(account_number, 4)) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger bank_details_set_updated_at
  before update on public.bank_details
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Sections and roles (managed by admins from the app)
-- -----------------------------------------------------------------------------
create table public.sections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 2 and 60),
  description text check (char_length(description) <= 300),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index sections_name_unique on public.sections (lower(name));

create trigger sections_set_updated_at
  before update on public.sections
  for each row execute function public.set_updated_at();

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references public.sections (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 2 and 60),
  description text check (char_length(description) <= 300),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index roles_section_name_unique on public.roles (section_id, lower(name));
create index roles_section_id_idx on public.roles (section_id);

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

-- Many-to-many: a member can hold several roles across any sections.
create table public.member_roles (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role_id     uuid not null references public.roles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index member_roles_role_id_idx on public.member_roles (role_id);

-- -----------------------------------------------------------------------------
-- Work submissions
-- -----------------------------------------------------------------------------
create table public.submissions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  -- restrict: a role that already has logged work cannot be deleted by accident
  role_id       uuid not null references public.roles (id) on delete restrict,
  work_month    date not null check (extract(day from work_month) = 1),
  title         text not null check (char_length(trim(title)) between 2 and 150),
  description   text check (char_length(description) <= 2000),
  quantity      integer not null default 1 check (quantity between 1 and 100000),
  date_done     date not null,
  links         text[] not null default '{}' check (cardinality(links) <= 10),
  status        public.submission_status not null default 'pending',
  admin_comment text check (char_length(admin_comment) <= 1000),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index submissions_user_month_idx on public.submissions (user_id, work_month);
create index submissions_month_status_idx on public.submissions (work_month, status);
create index submissions_role_id_idx on public.submissions (role_id);
create index submissions_reviewed_by_idx on public.submissions (reviewed_by);

create trigger submissions_set_updated_at
  before update on public.submissions
  for each row execute function public.set_updated_at();

-- Members cannot review their own work or change work that was already reviewed.
-- Admin reviews are stamped with reviewer + time automatically.
create or replace function public.guard_submission_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  acting_user uuid := (select auth.uid());
begin
  -- SQL editor / service role (no auth.uid()) is trusted.
  if acting_user is null then
    return new;
  end if;

  if public.is_admin() then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
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

create trigger submissions_guard_changes
  before insert or update on public.submissions
  for each row execute function public.guard_submission_changes();

-- -----------------------------------------------------------------------------
-- Attachments (files live in the private "attachments" storage bucket)
-- -----------------------------------------------------------------------------
create table public.submission_attachments (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null check (char_length(file_name) between 1 and 200),
  mime_type     text,
  size_bytes    integer not null check (size_bytes between 1 and 10485760),
  created_at    timestamptz not null default now()
);

create index submission_attachments_submission_idx on public.submission_attachments (submission_id);
create index submission_attachments_user_idx on public.submission_attachments (user_id);

-- -----------------------------------------------------------------------------
-- Report view: approved work per member, month and role.
-- security_invoker = true so the caller's RLS applies (admins see everyone).
-- -----------------------------------------------------------------------------
create view public.approved_work_summary
with (security_invoker = true) as
select
  s.user_id,
  s.work_month,
  s.role_id,
  count(*)::integer        as approved_count,
  sum(s.quantity)::integer as total_quantity
from public.submissions s
where s.status = 'approved'
group by s.user_id, s.work_month, s.role_id;
