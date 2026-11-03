-- =============================================================================
-- Citypak integration, slice 2: orders & waybills (read-only). Safe to run more than once.
--
-- One row per Citypak order (Citypak's "orders/created" list). Only fields seen
-- in Citypak's responses are kept: its id, tracking number, reference and
-- creation time. No recipient details, no courier status (its values are not
-- verified yet). Orders are NOT linked to bulk uploads, rounds or COD records.
--
-- Matching with Tute dispatch parcels is worked out when read (view
-- citypak_order_matches) from exact identifiers only – tracking number and
-- parcel reference – and never changes any parcel, round or COD record.
--
-- Saving reuses slice 1's pattern: server (service role) only, account/mode
-- checked, runs recorded in citypak_sync_runs (stream 'orders'), failures by
-- citypak_record_failed_sync in their own call.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table if not exists public.citypak_orders (
  id                  uuid primary key default gen_random_uuid(),
  account             text not null check (account ~ '^[a-z0-9_-]{1,40}$'),
  mode                text not null check (mode in ('fixture', 'live')),
  external_id         bigint not null check (external_id > 0),
  tracking_no         text check (tracking_no ~ '^[A-Z0-9]{4,30}$'),
  reference           text not null default '' check (reference = '' or reference ~ '^[A-Z0-9-]{1,60}$'),
  external_created_at timestamptz,
  payload_hash        text not null check (payload_hash ~ '^[0-9a-f]{32}$'),
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (account, external_id),
  constraint citypak_orders_fixture_mode check ((account = 'fixture') = (mode = 'fixture'))
);
create index if not exists citypak_orders_list_idx
  on public.citypak_orders (account, external_created_at desc nulls last, external_id desc);
create index if not exists citypak_orders_tracking_idx on public.citypak_orders (account, tracking_no) where tracking_no is not null;
create index if not exists citypak_orders_reference_idx on public.citypak_orders (account, reference) where reference <> '';

-- What changed about an order, and when (append-only, like parcel_events).
create table if not exists public.citypak_order_history (
  id               bigint generated always as identity primary key,
  order_id         uuid not null references public.citypak_orders (id) on delete cascade,
  kind             text not null check (kind in ('first_seen', 'changed')),
  tracking_no      text,
  prev_tracking_no text,
  reference        text,
  prev_reference   text,
  actor            uuid references public.profiles (id),
  created_at       timestamptz not null default now()
);
create index if not exists citypak_order_history_order_idx on public.citypak_order_history (order_id, created_at);
-- No "on delete set null": that would UPDATE append-only history, which the trigger
-- refuses. Deleting a profile with Citypak history is refused outright instead –
-- people are deactivated (profiles.is_active), not deleted. (Re-stated for re-runs.)
alter table public.citypak_order_history drop constraint if exists citypak_order_history_actor_fkey;
alter table public.citypak_order_history
  add constraint citypak_order_history_actor_fkey foreign key (actor) references public.profiles (id);

create or replace function public.citypak_order_history_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Citypak order history cannot be changed or deleted.' using errcode = '42501';
end;
$$;

drop trigger if exists citypak_order_history_no_update on public.citypak_order_history;
create trigger citypak_order_history_no_update
  before update or delete on public.citypak_order_history
  for each row execute function public.citypak_order_history_append_only();

-- Sync runs now cover orders too.
alter table public.citypak_sync_runs drop constraint if exists citypak_sync_runs_stream_check;
alter table public.citypak_sync_runs
  add constraint citypak_sync_runs_stream_check check (stream in ('bulk_uploads', 'orders'));

-- -----------------------------------------------------------------------------
-- 2. Save one orders sync (server only)
-- -----------------------------------------------------------------------------
-- p_rows: [{external_id, tracking_no, reference, external_created_at}], validated by the app.
-- Repeated ids: the last one wins. Nothing is ever deleted.
create or replace function public.citypak_sync_orders(
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
  perform pg_advisory_xact_lock(hashtextextended('citypak-orders:' || p_account, 0));

  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'Too many orders in one sync.' using errcode = 'P0001';
  end if;

  with incoming as (
    select distinct on (r.external_id)
           r.external_id, nullif(r.tracking_no, '') as tracking_no, coalesce(r.reference, '') as reference,
           r.external_created_at
      from jsonb_array_elements(p_rows) with ordinality as e(v, ord)
      cross join lateral jsonb_to_record(e.v) as r(external_id bigint, tracking_no text, reference text,
                                                    external_created_at timestamptz)
     order by r.external_id, e.ord desc
  ), hashed as (
    select i.*, md5(jsonb_build_array(i.tracking_no, i.reference, i.external_created_at)::text) as payload_hash
      from incoming i
  ), compared as (
    select h.*, o.id as old_id, o.payload_hash as old_hash, o.tracking_no as old_tracking, o.reference as old_reference
      from hashed h
      left join public.citypak_orders o on o.account = p_account and o.external_id = h.external_id
  ), saved as (
    insert into public.citypak_orders as o
      (account, mode, external_id, tracking_no, reference, external_created_at, payload_hash)
    select p_account, p_mode, external_id, tracking_no, reference, external_created_at, payload_hash
      from hashed
    on conflict (account, external_id) do update set
      tracking_no         = excluded.tracking_no,
      reference           = excluded.reference,
      external_created_at = excluded.external_created_at,
      payload_hash        = excluded.payload_hash,
      last_seen_at        = now(),
      updated_at          = case when o.payload_hash <> excluded.payload_hash then now() else o.updated_at end
    returning o.id, o.external_id
  ), history as (
    -- New orders, and orders whose tracking number or reference changed.
    insert into public.citypak_order_history (order_id, kind, tracking_no, prev_tracking_no, reference, prev_reference, actor)
    select s.id, case when c.old_id is null then 'first_seen' else 'changed' end,
           c.tracking_no, c.old_tracking, c.reference, c.old_reference, p_actor
      from saved s join compared c on c.external_id = s.external_id
     where c.old_id is null
        or c.old_tracking is distinct from c.tracking_no
        or c.old_reference is distinct from c.reference
    returning 1
  )
  select (select count(*) from saved),
         count(*) filter (where old_id is null),
         count(*) filter (where old_id is not null and old_hash <> payload_hash),
         count(*) filter (where old_id is not null and old_hash = payload_hash)
    into n_fetched, n_new, n_updated, n_unchanged
    from compared; -- (data-changing parts of a WITH, like "history", always run)

  outcome := case when coalesce(p_truncated, false) or rejected > 0 then 'partial' else 'ok' end;
  insert into public.citypak_sync_runs (stream, account, mode, actor, outcome, pages, fetched, new_count, updated_count,
                                        unchanged_count, rejected_count, truncated)
  values ('orders', p_account, p_mode, p_actor, outcome, greatest(coalesce(p_pages, 0), 0), n_fetched, n_new,
          n_updated, n_unchanged, rejected, coalesce(p_truncated, false));

  return jsonb_build_object('outcome', outcome, 'fetched', n_fetched, 'new', n_new, 'updated', n_updated,
                            'unchanged', n_unchanged, 'rejected', rejected, 'truncated', coalesce(p_truncated, false));
end;
$$;

-- The failure recorder now names its stream (bulk uploads stays the default).
drop function if exists public.citypak_record_failed_sync(uuid, text, text, text, integer, integer);
create or replace function public.citypak_record_failed_sync(
  p_actor uuid, p_account text, p_mode text, p_error text, p_pages integer default 0, p_fetched integer default 0,
  p_stream text default 'bulk_uploads'
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
  if p_stream is null or p_stream not in ('bulk_uploads', 'orders') then
    raise exception 'Unknown sync stream.' using errcode = 'P0001';
  end if;
  insert into public.citypak_sync_runs (stream, account, mode, actor, outcome, pages, fetched, error_class)
  values (p_stream, p_account, p_mode, p_actor, 'failed', greatest(coalesce(p_pages, 0), 0),
          greatest(coalesce(p_fetched, 0), 0), p_error);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Matching with Tute dispatch parcels (read-only, worked out when read)
-- -----------------------------------------------------------------------------
-- match_status:
--   matched        – the tracking number and the reference point to the same parcel
--                    (or only one was given and it was found)
--   reference_only – the reference matches a parcel that has no tracking number yet
--   conflict       – the identifiers disagree (see conflict_reason)
--   unmatched      – no parcel has either identifier
-- conflict_reason duplicate_tracking / duplicate_reference: another Citypak order of
-- the same account and mode has the same tracking number / reference. It may be a
-- reshipment – both orders are flagged for review, never merged or removed.
-- Only LIVE orders are compared with parcels: demo (fixture) orders are made up, so
-- a colliding identifier must never look like a real parcel match.
-- Names, phones and addresses are never used.
create or replace view public.citypak_order_matches
with (security_invoker = true) as
with base as (
  select o.*,
         pt.id as tracking_parcel_id, pt.reference as tracking_parcel_reference,
         pr.id as reference_parcel_id, pr.tracking_no as reference_parcel_tracking,
         (o.tracking_no is not null and exists (
            select 1 from public.citypak_orders d
             where d.account = o.account and d.mode = o.mode and d.tracking_no = o.tracking_no
               and d.id <> o.id)) as duplicate_tracking,
         (o.reference <> '' and exists (
            select 1 from public.citypak_orders d
             where d.account = o.account and d.mode = o.mode and d.reference = o.reference
               and d.id <> o.id)) as duplicate_reference
    from public.citypak_orders o
    left join public.parcels pt on o.mode = 'live' and pt.tracking_no = o.tracking_no
    left join public.parcels pr on o.mode = 'live' and o.reference <> '' and pr.reference = o.reference
)
select b.id, b.account, b.mode, b.external_id, b.tracking_no, b.reference, b.external_created_at,
       b.first_seen_at, b.last_seen_at, b.updated_at,
       coalesce(b.tracking_parcel_id, b.reference_parcel_id) as parcel_id,
       case
         when b.duplicate_tracking or b.duplicate_reference then 'conflict'
         when b.tracking_parcel_id is not null and b.reference_parcel_id is not null
           then case when b.tracking_parcel_id = b.reference_parcel_id then 'matched' else 'conflict' end
         when b.tracking_parcel_id is not null
           then case when b.reference = '' then 'matched' else 'conflict' end
         when b.reference_parcel_id is not null
           then case when b.reference_parcel_tracking is null then 'reference_only'
                     when b.tracking_no is null then 'matched'
                     else 'conflict' end
         else 'unmatched'
       end as match_status,
       case
         when b.duplicate_tracking then 'duplicate_tracking'
         when b.duplicate_reference then 'duplicate_reference'
         when b.tracking_parcel_id is not null and b.reference_parcel_id is not null
              and b.tracking_parcel_id <> b.reference_parcel_id then 'different_parcels'
         when b.tracking_parcel_id is not null and b.reference_parcel_id is null and b.reference <> ''
           then 'reference_differs'
         when b.tracking_parcel_id is null and b.reference_parcel_id is not null
              and b.reference_parcel_tracking is not null and b.tracking_no is not null then 'tracking_differs'
       end as conflict_reason,
       b.tracking_parcel_id, b.reference_parcel_id
  from base b;

-- -----------------------------------------------------------------------------
-- 4. Row level security and privileges
-- -----------------------------------------------------------------------------
alter table public.citypak_orders enable row level security;
alter table public.citypak_order_history enable row level security;

drop policy if exists "citypak_orders: courier and planners read" on public.citypak_orders;
create policy "citypak_orders: courier and planners read" on public.citypak_orders for select to authenticated
  using ((select public.has_dispatch('courier')) or (select public.has_dispatch('plan')));
drop policy if exists "citypak_order_history: courier and planners read" on public.citypak_order_history;
create policy "citypak_order_history: courier and planners read" on public.citypak_order_history for select to authenticated
  using ((select public.has_dispatch('courier')) or (select public.has_dispatch('plan')));

revoke all on table public.citypak_orders, public.citypak_order_history, public.citypak_order_matches from anon, authenticated;
grant select on table public.citypak_orders, public.citypak_order_history, public.citypak_order_matches to authenticated;

revoke all on function public.citypak_order_history_append_only() from public, anon, authenticated;
revoke all on function public.citypak_sync_orders(uuid, text, text, jsonb, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.citypak_record_failed_sync(uuid, text, text, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.citypak_sync_orders(uuid, text, text, jsonb, integer, integer, boolean) to service_role;
grant execute on function public.citypak_record_failed_sync(uuid, text, text, text, integer, integer, text) to service_role;
