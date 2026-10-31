-- Minimal stand-in for the parts of Supabase our migrations use, so they can
-- run on a throwaway local PostgreSQL. Test-only: never run this on Supabase.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant anon, authenticated, service_role to current_user;

grant usage on schema public to anon, authenticated, service_role;

-- Same default privileges as the production project (verified 31 Oct 2026):
-- new tables, sequences and functions are open to anon and authenticated
-- unless a migration revokes them.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- ---------------------------------------------------------------- auth
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Same lookups as Supabase: the request's JWT claims are in a setting.
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant execute on all functions in schema auth to anon, authenticated, service_role;

-- ---------------------------------------------------------------- storage
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now()
);

create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;

create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- pg_cron / pg_net / vault stubs
create schema cron;
create function cron.schedule(job_name text, schedule text, command text) returns bigint
  language sql as $$ select 1::bigint $$;

create schema net;
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                              headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
  returns bigint language sql as $$ select 1::bigint $$;

create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);
