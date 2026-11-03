-- =============================================================================
-- Citypak integration, slice 1: bulk-upload batches (read-only). Safe to run more than once.
--
-- A Citypak bulk upload is one uploaded sheet that became N waybills. It is
-- NOT a dispatch round: nothing here links a batch to a round or a parcel.
-- Rows are keyed by (account, external_id) so data from different Citypak
-- accounts – and fixture (demo) data – never mix.
-- The app fetches batches (fixture provider today; live only once Citypak
-- authorises it) and saves them through citypak_sync_bulk_uploads, which is
-- idempotent and records every run in citypak_sync_runs.
-- No personal data is stored: batch ids, file names, counts, statuses, times.
-- =============================================================================

create table if not exists public.citypak_bulk_uploads (
  id                  uuid primary key default gen_random_uuid(),
  account             text not null check (account ~ '^[a-z0-9_-]{1,40}$'),
  mode                text not null check (mode in ('fixture', 'live')),
  external_id         bigint not null check (external_id > 0),
  batch_reference     text not null default '' check (char_length(batch_reference) <= 60),
  file_name           text not null default '' check (char_length(file_name) <= 200),
  status              text not null check (status ~ '^[A-Z_]{1,30}$'),
  waybills            integer not null default 0 check (waybills between 0 and 100000),
  has_original_excel  boolean not null default false,
  started_at          timestamptz,
  ended_at            timestamptz,
  external_created_at timestamptz,
  payload_hash        text not null check (payload_hash ~ '^[0-9a-f]{32}$'),
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (account, external_id)
);
create index if not exists citypak_bulk_uploads_list_idx
  on public.citypak_bulk_uploads (account, external_created_at desc nulls last, external_id desc);

create table if not exists public.citypak_sync_runs (
  id              uuid primary key default gen_random_uuid(),
  stream          text not null check (stream in ('bulk_uploads')),
  account         text not null check (account ~ '^[a-z0-9_-]{1,40}$'),
  mode            text not null check (mode in ('fixture', 'live')),
  actor           uuid references public.profiles (id) on delete set null,
  outcome         text not null check (outcome in ('ok', 'failed')),
  pages           integer not null default 0 check (pages >= 0),
  fetched         integer not null default 0 check (fetched >= 0),
  new_count       integer not null default 0 check (new_count >= 0),
  updated_count   integer not null default 0 check (updated_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  rejected_count  integer not null default 0 check (rejected_count >= 0),
  truncated       boolean not null default false,
  error_class     text check (error_class ~ '^[a-z_]{1,40}$'),
  created_at      timestamptz not null default now(),
  check ((outcome = 'failed') = (error_class is not null))
);
create index if not exists citypak_sync_runs_recent_idx on public.citypak_sync_runs (account, stream, created_at desc);

-- Save one sync of bulk-upload batches (courier permission).
-- p_rows: [{external_id, batch_reference, file_name, status, waybills, has_original_excel,
--           started_at, ended_at, external_created_at}], already validated by the app.
-- p_error: an error class when fetching failed – only the failed run is recorded.
-- Repeated ids: the last one wins. Rows already saved and unchanged only get last_seen_at.
create or replace function public.citypak_sync_bulk_uploads(
  p_account text, p_mode text, p_rows jsonb, p_pages integer, p_rejected integer,
  p_truncated boolean default false, p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('courier');
  n_new integer := 0;
  n_updated integer := 0;
  n_unchanged integer := 0;
  n_fetched integer := 0;
begin
  if p_account is null or p_account !~ '^[a-z0-9_-]{1,40}$' or p_mode not in ('fixture', 'live') then
    raise exception 'Unknown Citypak account.' using errcode = 'P0001';
  end if;
  -- One sync per account at a time (manual clicks can't overlap).
  perform pg_advisory_xact_lock(hashtextextended('citypak-bulk-uploads:' || p_account, 0));

  if p_error is not null then
    insert into public.citypak_sync_runs (stream, account, mode, actor, outcome, pages, rejected_count, error_class)
    values ('bulk_uploads', p_account, p_mode, actor, 'failed', greatest(coalesce(p_pages, 0), 0),
            greatest(coalesce(p_rejected, 0), 0), left(p_error, 40));
    return jsonb_build_object('outcome', 'failed', 'error', p_error);
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'Too many batches in one sync.' using errcode = 'P0001';
  end if;

  -- One statement: every part sees the table as it was before this sync, so the
  -- counts compare the incoming rows with what was saved earlier.
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

  insert into public.citypak_sync_runs (stream, account, mode, actor, outcome, pages, fetched, new_count, updated_count,
                                        unchanged_count, rejected_count, truncated)
  values ('bulk_uploads', p_account, p_mode, actor, 'ok', greatest(coalesce(p_pages, 0), 0), n_fetched, n_new, n_updated,
          n_unchanged, greatest(coalesce(p_rejected, 0), 0), coalesce(p_truncated, false));

  return jsonb_build_object('outcome', 'ok', 'fetched', n_fetched, 'new', n_new, 'updated', n_updated,
                            'unchanged', n_unchanged, 'rejected', greatest(coalesce(p_rejected, 0), 0));
end;
$$;

-- Record a document download (Citypak documents can hold recipient details). Courier permission.
create or replace function public.citypak_log_document(p_upload uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := public.dispatch_require('courier');
  b public.citypak_bulk_uploads;
begin
  if p_kind not in ('filled_excel', 'waybills_4x6') then
    raise exception 'Unknown document.' using errcode = 'P0001';
  end if;
  select * into b from public.citypak_bulk_uploads where id = p_upload;
  if b.id is null then
    raise exception 'Bulk upload not found.' using errcode = 'P0001';
  end if;
  perform public.write_activity('dispatch.citypak_document', 'dispatch', b.id::text, null,
    'Opened Citypak ' || case p_kind when 'filled_excel' then 'Excel' else 'waybills (4×6)' end
      || ' for bulk upload ' || b.external_id || case when b.mode = 'fixture' then ' (demo data)' else '' end,
    jsonb_build_object('kind', p_kind, 'external_id', b.external_id, 'mode', b.mode, 'actor', actor));
end;
$$;

-- -----------------------------------------------------------------------------
-- Row level security and privileges (read: courier or plan)
-- -----------------------------------------------------------------------------
alter table public.citypak_bulk_uploads enable row level security;
alter table public.citypak_sync_runs enable row level security;

drop policy if exists "citypak_bulk_uploads: courier and planners read" on public.citypak_bulk_uploads;
create policy "citypak_bulk_uploads: courier and planners read" on public.citypak_bulk_uploads for select to authenticated
  using ((select public.has_dispatch('courier')) or (select public.has_dispatch('plan')));
drop policy if exists "citypak_sync_runs: courier and planners read" on public.citypak_sync_runs;
create policy "citypak_sync_runs: courier and planners read" on public.citypak_sync_runs for select to authenticated
  using ((select public.has_dispatch('courier')) or (select public.has_dispatch('plan')));

revoke all on table public.citypak_bulk_uploads, public.citypak_sync_runs from anon, authenticated;
grant select on table public.citypak_bulk_uploads, public.citypak_sync_runs to authenticated;

revoke all on function public.citypak_sync_bulk_uploads(text, text, jsonb, integer, integer, boolean, text) from public, anon, authenticated;
revoke all on function public.citypak_log_document(uuid, text) from public, anon, authenticated;
grant execute on function public.citypak_sync_bulk_uploads(text, text, jsonb, integer, integer, boolean, text) to authenticated;
grant execute on function public.citypak_log_document(uuid, text) to authenticated;
