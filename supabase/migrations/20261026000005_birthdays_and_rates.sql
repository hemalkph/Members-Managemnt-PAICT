-- =============================================================================
-- Birthdays (date of birth from the Sri Lankan NIC) and per-unit pay rates.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Date of birth from NIC
--   Old NIC: YYDDDnnnnV/X  (year 19YY)    New NIC: YYYYDDDnnnnn
--   DDD = day of the year; women have 500 added. NIC day numbers always treat
--   February as 29 days, so they are mapped on a leap-year calendar.
-- -----------------------------------------------------------------------------
create or replace function public.nic_birth_date(nic text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := upper(trim(coalesce(nic, '')));
  y int;
  d int;
  md date;
begin
  if v ~ '^[0-9]{9}[VX]$' then
    y := 1900 + substr(v, 1, 2)::int;
    d := substr(v, 3, 3)::int;
  elsif v ~ '^[0-9]{12}$' then
    y := substr(v, 1, 4)::int;
    d := substr(v, 5, 3)::int;
  else
    return null;
  end if;

  if d > 500 then d := d - 500; end if;
  if d < 1 or d > 366 then return null; end if;

  md := make_date(2000, 1, 1) + (d - 1);           -- 2000 is a leap year
  if extract(month from md) = 2 and extract(day from md) = 29
     and not (y % 4 = 0 and (y % 100 <> 0 or y % 400 = 0)) then
    return null;                                    -- 29 Feb in a non-leap year
  end if;
  return make_date(y, extract(month from md)::int, extract(day from md)::int);
exception when others then
  return null;
end;
$$;

alter table public.profiles add column if not exists date_of_birth date;

create or replace function public.set_birth_date_from_nic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.date_of_birth := public.nic_birth_date(new.nic);
  return new;
end;
$$;

drop trigger if exists profiles_birth_date_from_nic on public.profiles;
create trigger profiles_birth_date_from_nic
  before insert or update of nic on public.profiles
  for each row execute function public.set_birth_date_from_nic();

update public.profiles set date_of_birth = public.nic_birth_date(nic) where nic is not null;

-- -----------------------------------------------------------------------------
-- Pay rates
-- -----------------------------------------------------------------------------
alter table public.roles add column if not exists is_salaried boolean not null default false;

comment on column public.roles.is_salaried is 'Paid a fixed salary (no per-unit rates), e.g. WhatsApp Admin, LMS Admin.';

create table if not exists public.rate_items (
  id         uuid primary key default gen_random_uuid(),
  role_id    uuid not null references public.roles (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 60),
  unit       text not null default 'item' check (char_length(trim(unit)) between 1 and 20),
  price      numeric(12, 2) not null default 0 check (price >= 0 and price <= 10000000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rate_items_role_name_unique on public.rate_items (role_id, lower(name));
create index if not exists rate_items_role_id_idx on public.rate_items (role_id);

drop trigger if exists rate_items_set_updated_at on public.rate_items;
create trigger rate_items_set_updated_at
  before update on public.rate_items
  for each row execute function public.set_updated_at();

alter table public.rate_items enable row level security;
revoke all on public.rate_items from anon;

-- Members can see the rates of their own roles; admins manage everything.
create policy "rate_items: members read own role rates"
  on public.rate_items for select to authenticated
  using (
    exists (
      select 1 from public.member_roles mr
      where mr.user_id = (select auth.uid()) and mr.role_id = rate_items.role_id
    )
  );

create policy "rate_items: admins manage"
  on public.rate_items for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke execute on function public.nic_birth_date(text) from public, anon;
grant execute on function public.nic_birth_date(text) to authenticated, service_role;
