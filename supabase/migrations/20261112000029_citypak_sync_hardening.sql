-- =============================================================================
-- Citypak slice 1 hardening (audit H1, M1, M2). Safe to run more than once.
--
-- H1  Saving synced batches is now SERVER ONLY: the functions below can be run
--     by the service role alone, never by signed-in users through the API. The
--     app checks the person (Courier permission) with their own session first,
--     then calls these with the actor id it verified. Account and mode come from
--     the server's configuration, and the database refuses any mix of the demo
--     account with live mode (or the other way round).
-- M1  A failed sync is recorded by its own call (its own transaction), so it is
--     kept even when saving the batches failed and rolled back.
-- M2  Runs are 'ok' (complete), 'partial' (stopped at a limit or skipped bad
--     records – the batches read are saved) or 'failed' (nothing saved).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Rules on the tables
-- -----------------------------------------------------------------------------
-- The demo account is only ever demo data, and demo data only lives in the demo account.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'citypak_bulk_uploads_fixture_mode') then
    alter table public.citypak_bulk_uploads
      add constraint citypak_bulk_uploads_fixture_mode check ((account = 'fixture') = (mode = 'fixture'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'citypak_sync_runs_fixture_mode') then
    alter table public.citypak_sync_runs
      add constraint citypak_sync_runs_fixture_mode check ((account = 'fixture') = (mode = 'fixture'));
  end if;
end;
$$;

alter table public.citypak_sync_runs drop constraint if exists citypak_sync_runs_outcome_check;
alter table public.citypak_sync_runs
  add constraint citypak_sync_runs_outcome_check check (outcome in ('ok', 'partial', 'failed'));

-- The old version could be called by any signed-in Courier with made-up rows.
drop function if exists public.citypak_sync_bulk_uploads(text, text, jsonb, integer, integer, boolean, text);

-- -----------------------------------------------------------------------------
-- 2. Helpers (server only)
-- -----------------------------------------------------------------------------
-- Is this a real, active person? (Their Courier permission was checked by the
-- app with their own session; the service role can't see their session.)
create or replace function public.citypak_check_scope(p_actor uuid, p_account text, p_mode text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor is null or not exists (select 1 from public.profiles where id = p_actor and is_active) then
    raise exception 'Unknown person.' using errcode = '42501';
  end if;
  if p_account is null or p_account !~ '^[a-z0-9_-]{1,40}$' or p_mode is null or p_mode not in ('fixture', 'live')
     or (p_account = 'fixture') <> (p_mode = 'fixture') then
    raise exception 'Unknown Citypak account.' using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Save one sync (server only)
-- -----------------------------------------------------------------------------
-- p_rows: [{external_id, batch_reference, file_name, status, waybills, has_original_excel,
--           started_at, ended_at, external_created_at}], validated by the app.
-- Repeated ids: the last one wins (the same rule as the app). Nothing is ever
-- deleted, so a later sync completes what a partial one missed.
create or replace function public.citypak_sync_bulk_uploads(
  p_actor uuid, p_account text, p_mode text, p_rows jsonb, p_pages integer, p_rejected integer,
  p_truncated boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_new integer := 0;
  n_updated integer := 0;
  n_unchanged integer := 0;
  n_fetched integer := 0;
  rejected integer := greatest(coalesce(p_rejected, 0), 0);
  outcome text;
begin
  perform public.citypak_check_scope(p_actor, p_account, p_mode);
  -- One save per account at a time.
  perform pg_advisory_xact_lock(hashtextextended('citypak-bulk-uploads:' || p_account, 0));

  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'Too many batches in one sync.' using errcode = 'P0001';
  end if;

  -- One statement: every part sees the table as it was before this sync.
  with incoming as (
    select distinct on (r.external_id)
           r.external_id, coalesce(r.batch_reference, '') as batch_reference, coalesce(r.file_name, '') as file_name,
           upper(r.status) as status, coalesce(r.waybills, 0) as waybills,
           coalesce(r.has_original_excel, false) as has_original_excel,
           r.started_at, r.ended_at, r.external_created_at
      from jsonb_array_elements(p_rows) with ordinality as e(v, ord)
      cross join lateral jsonb_to_record(e.v) as r(
             external_id bigint, batch_reference text, file_name text, status text, waybills integer,
             has_original_excel boolean, started_at timestamptz, ended_at timestamptz, external_created_at timestamptz)
     order by r.external_id, e.ord desc
  ), hashed as (
    select i.*, md5(jsonb_build_array(i.batch_reference, i.file_name, i.status, i.waybills, i.has_original_excel,
                                      i.started_at, i.ended_at, i.external_created_at)::text) as payload_hash
      from incoming i
  ), compared as (
    select h.*, b.payload_hash as old_hash, b.id is not null as existed
      from hashed h
      left join public.citypak_bulk_uploads b on b.account = p_account and b.external_id = h.external_id
  ), saved as (
    insert into public.citypak_bulk_uploads as b
      (account, mode, external_id, batch_reference, file_name, status, waybills, has_original_excel,
       started_at, ended_at, external_created_at, payload_hash)
    select p_account, p_mode, external_id, batch_reference, file_name, status, waybills, has_original_excel,
           started_at, ended_at, external_created_at, payload_hash
      from hashed
    on conflict (account, external_id) do update set
      batch_reference     = excluded.batch_reference,
      file_name           = excluded.file_name,
      status              = excluded.status,
      waybills            = excluded.waybills,
      has_original_excel  = excluded.has_original_excel,
      started_at          = excluded.started_at,
      ended_at            = excluded.ended_at,
      external_created_at = excluded.external_created_at,
      payload_hash        = excluded.payload_hash,
      last_seen_at        = now(),
      updated_at          = case when b.payload_hash <> excluded.payload_hash then now() else b.updated_at end
    returning 1
  )
  select (select count(*) from saved),
         count(*) filter (where not existed),
         count(*) filter (where existed and old_hash <> payload_hash),
         count(*) filter (where existed and old_hash = payload_hash)
    into n_fetched, n_new, n_updated, n_unchanged
    from compared;

  outcome := case when coalesce(p_truncated, false) or rejected > 0 then 'partial' else 'ok' end;
  insert into public.citypak_sync_runs (stream, account, mode, actor, outcome, pages, fetched, new_count, updated_count,
                                        unchanged_count, rejected_count, truncated)
  values ('bulk_uploads', p_account, p_mode, p_actor, outcome, greatest(coalesce(p_pages, 0), 0), n_fetched, n_new,
          n_updated, n_unchanged, rejected, coalesce(p_truncated, false));

  return jsonb_build_object('outcome', outcome, 'fetched', n_fetched, 'new', n_new, 'updated', n_updated,
                            'unchanged', n_unchanged, 'rejected', rejected, 'truncated', coalesce(p_truncated, false));
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Record a failed sync (server only, its own call so it survives a rollback)
-- -----------------------------------------------------------------------------
-- p_error: a short error class (e.g. network, save_failed) – never a message or response body.
create or replace function public.citypak_record_failed_sync(
  p_actor uuid, p_account text, p_mode text, p_error text, p_pages integer default 0, p_fetched integer default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.citypak_check_scope(p_actor, p_account, p_mode);
  if p_error is null or p_error !~ '^[a-z_]{1,40}$' then
    raise exception 'Unknown error class.' using errcode = 'P0001';
  end if;
  insert into public.citypak_sync_runs (stream, account, mode, actor, outcome, pages, fetched, error_class)
  values ('bulk_uploads', p_account, p_mode, p_actor, 'failed', greatest(coalesce(p_pages, 0), 0),
          greatest(coalesce(p_fetched, 0), 0), p_error);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Privileges: service role only
-- -----------------------------------------------------------------------------
revoke all on function public.citypak_check_scope(uuid, text, text) from public, anon, authenticated;
revoke all on function public.citypak_sync_bulk_uploads(uuid, text, text, jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.citypak_record_failed_sync(uuid, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.citypak_sync_bulk_uploads(uuid, text, text, jsonb, integer, integer, boolean) to service_role;
grant execute on function public.citypak_record_failed_sync(uuid, text, text, text, integer, integer) to service_role;
